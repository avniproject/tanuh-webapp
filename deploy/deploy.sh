#!/usr/bin/env bash
# Deploy one site of the Tanuh webapp to the DQS instance in the Tanuh staging account:
#   deploy/deploy.sh <staging|uat> [ref]
#
#   staging  https://staging-tanuh.avniproject.org, the Tanuh staging org, DQS tenant
#            samvit-staging. No default ref: name the branch, tag or commit to try.
#   uat      https://uat-tanuh.avniproject.org, the Tanuh UAT org, DQS tenant samvit-uat.
#            Defaults to the open minor branch (UAT_REF below; see RELEASE_WORKFLOW.md).
#
# Both sites forward Avni's routes to Avni's prod server, where every Tanuh org is, and send
# /dqs/ to their own tenant's DQS API on the same instance. The DQS bundle must already run
# there: its Caddy serves the sites (data-quality-service, deploy/aws/).
#
# It builds the ref's committed tree, never the working tree. The ref must be a branch or tag
# on origin, or a commit on one of origin's branches, so what it deploys is what anyone can
# fetch; a local branch or tag of the same name is never used. The tree is exported with
# `git archive` into a temporary directory, so uncommitted changes and local .env files never
# reach a build. The build needs the Node major version in the ref's .nvmrc.
#
# On a laptop with no AWS session exported, it signs in with the profile in AWS_PROFILE, or
# tanuh-staging, which asks for the MFA code (tanuh-samanvay-infra/docs/access/README.md). It
# refuses a session for any other account.
#
# It then copies s3://dqs-staging-deploy-<account>/tanuh-webapp/<site>/current/ to previous/,
# uploads the build (dist/, site.caddy, VERSION) to current/, and through SSM Run Command
# runs deploy/install-site.sh on the instance, which puts it in /opt/tanuh-webapp/<site>/ and
# reloads Caddy. When the install fails (the instance still serves the previous site), or
# cannot be sent, the script copies previous/ back to current/, so the bucket names what the
# instance serves; for a site's first deploy that leaves current/ empty. When it loses track
# of the install, it cannot tell, and leaves current/ as it is. Exits 0 only when the new site
# is in place.
set -euo pipefail
# AWS CLI v2 otherwise opens long output in a pager that waits for q.
export AWS_PAGER=""

# The open minor branch, which UAT serves. Move it when the next minor line starts.
UAT_REF=1.13

region=ap-south-1
account=234432913930
avni_origin=https://app.avniproject.org
instance_name=dqs-staging
bucket="dqs-staging-deploy-$account"

fail() {
  echo "deploy.sh: $*" >&2
  exit 1
}

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  echo "usage: deploy/deploy.sh <staging|uat> [ref]" >&2
  exit 1
fi
site="$1"
ref="${2:-}"
case "$site" in
  staging)
    host=staging-tanuh.avniproject.org
    tenant=samvit-staging
    [ -n "$ref" ] || fail "staging has no default ref; name the branch, tag or commit to deploy"
    ;;
  uat)
    host=uat-tanuh.avniproject.org
    tenant=samvit-uat
    ref="${ref:-$UAT_REF}"
    ;;
  *)
    echo "usage: deploy/deploy.sh <staging|uat> [ref]" >&2
    exit 1
    ;;
esac
avni_host="${avni_origin#https://}"
prefix="s3://$bucket/tanuh-webapp/$site"

for tool in aws jq node npm; do
  command -v "$tool" >/dev/null || fail "$tool is not installed"
done

cd "$(git rev-parse --show-toplevel)"

# The commit to build: a branch as origin has it, else a tag or a commit.
git fetch --quiet --tags origin
# A local branch or tag of the same name is never used: it may hold commits origin lacks.
if commit="$(git rev-parse --verify --quiet "refs/remotes/origin/$ref^{commit}")"; then
  :
elif tagged="$(git ls-remote origin "refs/tags/$ref" "refs/tags/$ref^{}" | tail -1 | cut -f1)" &&
  [ -n "$tagged" ]; then
  # The last line is the commit an annotated tag points to, or a lightweight tag's own.
  commit="$(git rev-parse --verify "$tagged^{commit}")"
elif [[ "$ref" =~ ^[0-9a-f]{7,40}$ ]] &&
  commit="$(git rev-parse --verify --quiet "$ref^{commit}")" &&
  [ -n "$(git branch -r --contains "$commit")" ]; then
  :
else
  fail "$ref is not a branch or tag on origin, or a commit on one of origin's branches"
fi
short="$(git rev-parse --short=12 "$commit")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/src" "$work/out"
git archive "$commit" | tar -x -C "$work/src"

want="$(tr -d 'v[:space:]' <"$work/src/.nvmrc" | cut -d. -f1)"
have="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$want" != "$have" ]; then
  fail "$ref builds with Node $want (.nvmrc) and this shell has Node $have; switch, e.g. nvm use $want"
fi

# Signing in comes before the build, so that the MFA code is asked for at the start.
if [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
  profile="${AWS_PROFILE:-tanuh-staging}"
  aws sts get-caller-identity --profile "$profile" >/dev/null ||
    fail "could not sign in with the AWS profile $profile"
  session="$(aws configure export-credentials --profile "$profile" --format env)" ||
    fail "could not export the session of the AWS profile $profile"
  eval "$session"
fi
caller="$(aws sts get-caller-identity --query Account --output text)"
[ "$caller" = "$account" ] || fail "the AWS session is for account $caller; the Tanuh staging account is $account"

instances="$(aws ec2 describe-instances --region "$region" \
  --filters "Name=tag:Name,Values=$instance_name" "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].[InstanceId,PublicIpAddress]' --output text)"
[ "$(printf '%s\n' "$instances" | grep -c .)" = 1 ] ||
  fail "expected one running $instance_name instance, found: ${instances:-none}"
read -r instance_id public_ip <<<"$instances"

echo "== building $ref ($short) for $site, DQS tenant $tenant"
(
  cd "$work/src"
  npm ci --no-audit --no-fund
  # The values already in the environment win over any .env file Vite would read.
  VITE_AVNI_API_BASE_URL="" VITE_DQS_API_BASE_URL=/dqs VITE_DQS_TENANT="$tenant" npm run build
)
[ -f "$work/src/dist/index.html" ] || fail "the build made no dist/index.html"
mv "$work/src/dist" "$work/out/dist"
sed -e "s#__SITE_ADDRESS__#$host#" -e "s#__SITE__#$site#g" -e "s#__TENANT__#$tenant#" \
  -e "s#__AVNI_ORIGIN__#$avni_origin#" -e "s#__AVNI_HOST__#$avni_host#" \
  deploy/site.caddy >"$work/out/site.caddy"
if grep -q '__[A-Z_]*__' "$work/out/site.caddy"; then
  fail "site.caddy has a name left unfilled: $(grep -o '__[A-Z_]*__' "$work/out/site.caddy" | head -1)"
fi
cat >"$work/out/VERSION" <<VERSION
ref=$ref
commit=$commit
site=$site
tenant=$tenant
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
built_by=$(git config user.name || whoami)
VERSION

echo "== uploading to $prefix/current/"
aws s3 sync --region "$region" --delete --quiet "$prefix/current/" "$prefix/previous/"
aws s3 sync --region "$region" --delete --quiet "$work/out/" "$prefix/current/"

echo "== installing on $instance_id"
# install-site.sh travels base64-encoded and runs under bash, whatever shell Run Command uses.
install="$(base64 <deploy/install-site.sh | tr -d '\n')"
remote="echo $install | base64 -d | bash -s -- $site $prefix/current $region"
parameters="$(jq -n --arg command "$remote" '{commands: [$command], executionTimeout: ["600"]}')"
# previous/ is empty before a site's first deploy, and syncing it empties current/, which is
# then right: the instance serves no build of the site.
restore_current() { # <why>
  aws s3 sync --region "$region" --delete --quiet "$prefix/previous/" "$prefix/current/"
  if aws s3 ls --region "$region" "$prefix/current/VERSION" >/dev/null 2>&1; then
    fail "$1; $prefix/current/ holds the previous build again"
  fi
  fail "$1; $prefix/current/ is empty again, as the site had no earlier build"
}

command_id="$(aws ssm send-command --region "$region" --instance-ids "$instance_id" \
  --document-name AWS-RunShellScript --timeout-seconds 600 --parameters "$parameters" \
  --query Command.CommandId --output text)" || restore_current "the install could not be sent"

# The invocation does not exist for a few seconds after send-command, so a failed call is
# retried; thirty in a row (five minutes) usually means the MFA session expired.
failures=0
while :; do
  sleep 5
  if ! status="$(aws ssm get-command-invocation --region "$region" --command-id "$command_id" \
    --instance-id "$instance_id" --query Status --output text 2>/dev/null)"; then
    failures=$((failures + 1))
    [ "$failures" -lt 30 ] || fail "lost track of the install, which may still be running;" \
      "$prefix/current/ holds the new build whether or not the instance serves it. With a" \
      "fresh session, run aws ssm get-command-invocation --command-id $command_id" \
      "--instance-id $instance_id, and deploy again if it failed"
    continue
  fi
  failures=0
  case "$status" in
    Pending | InProgress | Delayed) ;;
    *) break ;;
  esac
done
for stream in StandardOutputContent StandardErrorContent; do
  aws ssm get-command-invocation --region "$region" --command-id "$command_id" \
    --instance-id "$instance_id" --query "$stream" --output text
done
if [ "$status" != Success ]; then
  restore_current "the install ended with status $status"
fi

echo "deployed $ref ($short) to $site"
resolved="$( (dig +short "$host" A 2>/dev/null || true) | tail -1)"
if [ "$resolved" = "$public_ip" ]; then
  if curl -fsS --max-time 20 "https://$host/" | grep -q '<div id="root"'; then
    echo "https://$host/ serves the app"
  else
    echo "https://$host/ does not serve the app yet; Caddy may still be getting its certificate" >&2
  fi
else
  echo "$host resolves to ${resolved:-nothing}, not the instance ($public_ip): point its A record" \
    "at $public_ip in the avniproject.org zone; Caddy gets the certificate once it resolves"
fi

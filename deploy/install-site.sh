#!/usr/bin/env bash
# Put one site's build in place on the DQS instance and reload Caddy:
#   install-site.sh <site> <s3 prefix of the build> <region>
#
# deploy/deploy.sh sends this to the instance through SSM Run Command, where it runs as root.
# It copies the build (dist/, site.caddy, VERSION) from the prefix into
# /opt/.tanuh-webapp-swap/incoming-<site>/, swaps it in for /opt/tanuh-webapp/<site>/, and has
# DQS's Caddy reload its configuration, which imports every site's site.caddy. When Caddy
# refuses the configuration, it puts the previous site back and reloads again.
#
# The incoming and previous copies are kept beside /opt/tanuh-webapp, never in it: Caddy's
# import pattern /srv/tanuh-webapp/*/site.caddy also matches folders whose names start with a
# dot, and a second copy of a site there names the same host twice, which Caddy refuses. They
# are on the same file system, so each swap is a rename.
#
# Exits 0 when the new site is in place, 1 on wrong arguments, 2 when the build in S3 is
# incomplete, 3 when Caddy refused the new site (the previous one is back), and 4 when DQS's
# Caddy is not running with the sites mounted, which a DQS bundle older than the webapp sites
# does not do. TANUH_WEBAPP_ROOT and DQS_COMPOSE_FILE are set only by tests.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: install-site.sh <site> <s3 prefix> <region>" >&2
  exit 1
fi
site="$1"
prefix="$2"
region="$3"
base="${TANUH_WEBAPP_ROOT:-/opt/tanuh-webapp}"
swap="$(dirname "$base")/.tanuh-webapp-swap"
incoming="$swap/incoming-$site"
previous="$swap/previous-$site"
compose=(docker compose -f "${DQS_COMPOSE_FILE:-/opt/dqs/compose.yaml}")

reload() {
  "${compose[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}

caddy_id="$("${compose[@]}" ps -q caddy || true)"
if [ -z "$caddy_id" ] ||
  ! docker inspect --format '{{range .Mounts}}{{.Destination}} {{end}}' "$caddy_id" |
  grep -qw /srv/tanuh-webapp; then
  echo "install-site.sh: DQS's Caddy is not running with /srv/tanuh-webapp mounted;" \
    "deploy a DQS bundle that serves the webapp sites first" >&2
  exit 4
fi

mkdir -p "$base" "$swap"
rm -rf "$incoming" "$previous"
aws s3 sync --region "$region" --quiet "$prefix/" "$incoming/"
if [ ! -f "$incoming/site.caddy" ] || [ ! -f "$incoming/dist/index.html" ]; then
  echo "install-site.sh: $prefix/ has no site.caddy or dist/index.html" >&2
  rm -rf "$incoming"
  exit 2
fi

if [ -d "$base/$site" ]; then
  mv "$base/$site" "$previous"
fi
mv "$incoming" "$base/$site"
if ! reload; then
  echo "install-site.sh: Caddy refused the new site; putting the previous one back" >&2
  rm -rf "${base:?}/$site"
  if [ -d "$previous" ]; then
    mv "$previous" "$base/$site"
  fi
  reload || echo "install-site.sh: Caddy refused the previous site too" >&2
  exit 3
fi
rm -rf "$previous"
cat "$base/$site/VERSION"

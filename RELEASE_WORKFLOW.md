# Release Workflow

tanuh-webapp follows Avni's release naming and branching, the same model avni-webapp uses
(avni-readme `docs/developers/contribute-to-avni/branching-strategy.md`). Adopted 2026-10-01;
before that the repo ran `develop` → `main` plus stacked `mvp/*` and `hotfix/*` branches, which
were retired into the release branches below.

## Branches

- **`X.Y`: one branch per minor release** (`1.11`, `1.12`, `1.13`). A new minor branch is cut
  from the previous release branch (`1.13` from `1.12`). Patch releases (`1.12.3`) are committed
  and tagged **on their minor branch**. There are no hotfix branches.
- **`main`: the mainline.** Every release branch is merged into it; it is never deployed by itself.
- **Feature branches** (`pe-NNN-short-name`) are cut from the release branch they ship in and
  merged back into it, preferably by pull request so CI runs on them.

## Which branch serves which site

| Site | Serves | Infra pin (`avni-infra/configure/prod_tanuh_metabase_servers.yml`) |
|---|---|---|
| UAT: https://uat-tanuh.avniproject.org | head of the open minor branch | `tanuh_webapp_git_ref: <open minor branch>` |
| Prod: https://tanuh.avniproject.org | a release tag | `tanuh_webapp_git_ref: <live tag>` |

Staging (org 1187) has no site of its own; its users log in through the UAT site. Both sites proxy
the same Avni server, so the org you log in with is the only data boundary.

## Making a change

1. **A fix for what prod runs:** commit it on the oldest release branch it applies to, then
   **merge forward** into every newer release branch and `main` (`1.12` → `1.13` → `main`). Merge;
   do not cherry-pick between release branches.
2. **New work:** a feature branch from the open minor branch, merged back into it.
3. **UAT:** `make tanuh-webapp-uat` deploys the pinned branch; `EXTRA_ARGS='-e tanuh_webapp_git_ref=<ref>'`
   deploys any other ref. Check the result with the org repo's `verify_deploy.sh`.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on pull requests and on
pushes to `main` and every `X.Y` branch.

## Releasing `X.Y.Z`

1. On the release branch, set `"version": "X.Y.Z"` in `package.json`, run
   `npm run lint && npm run typecheck && npm test && npm run build`, commit, push, and wait for CI.
2. Tag the branch head and push the tag:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. Merge the release branch forward into every newer release branch and `main`.
4. Prod deploys the **tag**, and only on explicit sign-off:
   `EXTRA_ARGS='-e tanuh_webapp_git_ref=vX.Y.Z' make tanuh-webapp-prod`. Then bump the infra prod
   pin to that tag so a bare prod deploy cannot drift.
5. When the next minor line starts: `git branch X.(Y+1) X.Y && git push origin X.(Y+1)`.

Pre-release builds on an open minor branch may carry `X.Y.0-<label>.N` (e.g. `1.13.0-mvp.7`); the
release commit sets `X.Y.0`.

## Summary

fix on `X.Y` → tag `vX.Y.Z` on `X.Y` → merge forward to newer `X.Y` branches and `main`

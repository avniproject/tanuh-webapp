# avni-tanuh-physician-app

Physician Review CRUD webapp for Tanuh. Sits on top of Avni Web APIs.

## Stack

React 18 + TypeScript + Material UI v7 + Vite. Auth reuses the IDP pattern from `avni-webapp` (Cognito + Keycloak via `/idp-details`).

## Run

```bash
cp .env.example .env
# edit VITE_AVNI_API_BASE_URL to point at the target Avni server
npm install
npm run dev
```

## Build

```bash
npm run build
# dist/ is a static bundle, serve at any path under the Avni origin
```

## Configuration

| Env var | Description |
|---|---|
| `VITE_AVNI_API_BASE_URL` | Origin of the Avni server (e.g. `https://staging.avniproject.org`). |

## Avni-side prerequisites

The Tanuh org instance must have:
- Subject type, "Patient Registration" form, "Oral Screening" encounter type, "Physician Review Form" encounter type — present in the `Tanuh_UAT` impl bundle.
- A visit-schedule rule on the Oral Screening encounter that schedules a "Physician Review Form" encounter on completion.
- A "Physician" user group with privileges on the Physician Review Form encounter type.
- Each Physician user assigned the catchment locations they review.

## Releases & promotion (prod ⇄ UAT)

Two instances of this app run on the **same** Tanuh reporting node, deployed from
`avni-infra` (`configure/`):

- **UAT** — `https://uat-tanuh.avniproject.org`, tracks **`main`**. Deploy: `make tanuh-webapp-uat`.
- **Prod** — `https://tanuh.avniproject.org`, pinned to a **release tag** (never `main`). Currently **`v1.5.0`** (avni-infra prod role var `tanuh_webapp_git_ref`). Deploy: `make tanuh-webapp-prod`.

**Promotion flow:**
1. Merge the change to `main` → `make tanuh-webapp-uat`.
2. Validate on `uat-tanuh.avniproject.org` — log in with a **`Tanuh_UAT`-org** account (both instances proxy the *same* prod Avni; the only data boundary is your org, so a prod-org login would show prod data).
3. On sign-off, tag the approved commit: `git tag -a vX.Y.Z <sha> -m "…" && git push origin vX.Y.Z`.
4. Bump `tanuh_webapp_git_ref` to that tag in `avni-infra/configure/prod_tanuh_metabase_servers.yml`, then `make tanuh-webapp-prod`.

The prod pin means a bare prod deploy never drifts to `main`.

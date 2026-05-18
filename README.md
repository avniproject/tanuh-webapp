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

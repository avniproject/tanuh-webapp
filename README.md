# tanuh-webapp

The Tanuh webapp has two sections, and a signed-in user sees the ones their Avni user groups
allow:

- **Clinician Review** (`/pending`, `/completed`, `/review/:uuid`), for the **Physician** group:
  lists oral screenings waiting for review and writes the physician's verdict back to Avni.
  It sits on top of Avni Web APIs.
- **Data Quality** (`/data-quality/*`), for the **Programme Manager** group: the health check,
  workers and quality dimensions screens, read from the data quality service (DQS).

A user in both groups lands on the reviews and switches with the header's buttons; a user in
neither sees a Not authorised page.

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
| `VITE_AVNI_PROXY_TARGET` | Dev only: the Avni server the dev server forwards API calls to. |
| `VITE_DQS_API_BASE_URL` | Where the Data Quality screens call DQS; `/dqs` when unset. |
| `VITE_DQS_PROXY_TARGET` | Dev only: the DQS the dev server forwards `/dqs` to. |
| `VITE_DQS_TENANT` | The DQS tenant the Data Quality screens read, e.g. `samvit`. |

`.env.example` explains each one, including how `/dqs` is served in production.

## Avni-side prerequisites

The Tanuh org instance must have:
- Subject type, "Patient Registration" form, "Oral Screening" encounter type, "Physician Review Form" encounter type — present in the `Tanuh_UAT` impl bundle.
- A visit-schedule rule on the Oral Screening encounter that schedules a "Physician Review Form" encounter on completion.
- A "Physician" user group with privileges on the Physician Review Form encounter type.
- Each Physician user assigned the catchment locations they review.
- Optional: the same encounter types recorded inside a program (Tanuh Staging's NCD program, PE-83). The app reads program visits through the stock `/api/programEncounters` API alongside the standalone ones, completes a program review on `/api/programEncounter/{id}`, and schedules its High Risk Referral / Referral Slip in the review's own enrolment on `/web/programEncounters` (the external API cannot name a planned visit — PE-125). The Physician group then needs program-scoped ViewVisit on the review and screening types. Program list rows are assembled in the browser (one subject request per patient), which suits a small org; at scale `/api/impl/encountersWithLocation` should return program visits too.
- A "Programme Manager" user group for the users who see the Data Quality screens.

## DQS-side prerequisites

The Data Quality screens send the signed-in user's Avni ID token to DQS, which accepts only
the users its tenant authentication file lists. Each programme manager has to be added there,
and the host serving this app has to forward `/dqs` to DQS (or `VITE_DQS_API_BASE_URL` has
to name DQS's address, with DQS allowing this app's origin).

## Releases & promotion (prod ⇄ UAT)

Two instances of this app run on the **same** Tanuh reporting node, deployed from
`avni-infra` (`configure/`). Branching and releases follow Avni's model, one `X.Y` branch per
minor release with fixes merged forward. See [`RELEASE_WORKFLOW.md`](RELEASE_WORKFLOW.md).

- **UAT**: `https://uat-tanuh.avniproject.org` serves the head of the open minor branch.
  Deploy: `make tanuh-webapp-uat`.
- **Prod**: `https://tanuh.avniproject.org` serves a **release tag**, never a branch head
  (avni-infra prod role var `tanuh_webapp_git_ref`). Deploy only on sign-off:
  `EXTRA_ARGS='-e tanuh_webapp_git_ref=vX.Y.Z' make tanuh-webapp-prod`.

Validate on UAT with a **`Tanuh_UAT`-org** account. Both instances proxy the *same* prod Avni, so
the only data boundary is your org, and a prod-org login would show prod data.

Which version runs where today, and what is pending, is tracked in the org repo:
`avniproject/tanuh-implementation` → `docs/physician-webapp.md`.

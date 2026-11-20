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
- Optional: the same encounter types recorded inside a program (Tanuh Staging's NCD program, PE-83). The app reads program visits through the stock `/api/programEncounters` API alongside the standalone ones, completes a program review on `/api/programEncounter/{id}`, and schedules its High Risk Referral / Referral Slip in the review's own enrolment on `/web/programEncounters` (the external API cannot name a planned visit — PE-125). The Physician group then needs program-scoped ViewVisit on the review and screening types. Program list rows are assembled in the browser (one subject request per patient), which suits a small org; at scale `/api/impl/encountersWithLocation` should return program visits too.

## Releases & promotion (staging → UAT → prod)

Each Tanuh org on Avni's prod server has a site of its own. Changes move staging → UAT → prod.
Branching and releases follow Avni's model, one `X.Y` branch per minor release with fixes merged
forward. See [`RELEASE_WORKFLOW.md`](RELEASE_WORKFLOW.md).

| Site | Org | Serves | Runs on | Deploy |
|---|---|---|---|---|
| `https://staging-tanuh.avniproject.org` | Tanuh staging | any ref you name | DQS instance, Tanuh staging account | run the `deploy` workflow with `site=staging` and the ref, or `make deploy-staging REF=<ref>` |
| `https://uat-tanuh.avniproject.org` | Tanuh UAT | head of the open minor branch | DQS instance, Tanuh staging account | automatic on every push to the open minor branch; `make deploy-uat` |
| `https://tanuh.avniproject.org` | Tanuh prod | a **release tag**, never a branch head | Tanuh reporting node, Avni account (`avni-infra`) | `EXTRA_ARGS='-e tanuh_webapp_git_ref=vX.Y.Z' make tanuh-webapp-prod` in `avni-infra/configure`, only on sign-off |

**Staging and UAT** run on the data quality service's instance in the Tanuh staging AWS account,
served by its Caddy, beside DQS's tenants for the same two orgs (`samvit-staging` and
`samvit-uat`). `deploy/deploy.sh` builds the ref's committed tree with the site's DQS tenant,
uploads it, and installs it on the instance through SSM; `deploy/site.caddy` is the site's Caddy
configuration and `deploy/install-site.sh` what runs on the instance. Each site forwards Avni's
routes to Avni's prod server and `/dqs/` to its own DQS tenant.

GitHub Actions runs `deploy/deploy.sh` (`.github/workflows/deploy.yml`): every push to the open
minor branch (`UAT_REF` in `deploy/deploy.sh`) is checked and deployed to UAT, and the workflow
can be run by hand, from the Actions tab or with
`gh workflow run deploy.yml -f site=staging -f ref=<ref>`, to deploy any ref to staging or UAT.
It signs in as the `tanuh-webapp-deploy` role, which `tanuh-samanvay-infra` creates and which
trusts only this repository's `staging` and `uat` environments.

Run from a laptop, the script needs the `tanuh-staging`
AWS profile (`tanuh-samanvay-infra/docs/access/README.md`), `jq`, and the Node version in
`.nvmrc`; the DQS bundle must already run on the instance (`data-quality-service`,
`deploy/aws/README.md`). The deploy and the instance's tooling come from the checkout you run
it in, the app from the ref you name.

**Prod** stays on the Tanuh reporting node until it moves to the Tanuh prod account.

Validate with an account of the site's org. Every site proxies the *same* prod Avni, so the only
data boundary is your org, and a prod-org login would show prod data.

Which version runs where today, and what is pending, is tracked in the org repo:
`avniproject/tanuh-implementation` → `docs/physician-webapp.md`.

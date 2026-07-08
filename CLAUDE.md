# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Setup
cp .env.example .env
# Edit VITE_AVNI_API_BASE_URL to point at the target Avni server
npm install

# Development
npm run dev          # Vite dev server on port 3010 (proxies API calls upstream)
npm run build        # tsc -b && vite build → static bundle in dist/
npm run preview      # Preview the production build
npm run lint         # ESLint, zero-warnings policy (--max-warnings 0)
npm run typecheck    # tsc -b --noEmit
```

There is no test runner configured. Verify changes with `lint` + `typecheck` and by exercising the flow in the browser.

## Release Workflow

See `RELEASE_WORKFLOW.md`: make changes on `develop`, test there, merge to `main`, then tag the release `vX.Y.Z` (semver, `v` prefix).

## What this app is

A React 18 + TypeScript + Material UI v7 (Vite) webapp for **clinician/physician review** of oral-cancer screenings. It is a thin CRUD client over **Avni Web APIs** — it holds no database. A worker completes an "Oral Screening" encounter on mobile; an Avni visit-schedule rule then schedules a review encounter; this app lists those pending reviews, shows the screening data + photos, and writes the clinician's verdict back as observations on the review encounter.

## Architecture — the big picture

### Everything is Avni observations keyed by concept *name*
The Avni external API serializes an encounter's/subject's `observations` as a flat object keyed by the concept's **display name**, not its UUID (see the comment atop `src/api/types.ts`). So call sites read values by name. `src/constants/tanuhConcepts.ts` is the single source of truth mirroring the `Tanuh_UAT` bundle: it holds `{ name, uuid }` for every concept, plus `legacyNames` on concepts that were renamed server-side (e.g. ASHA→Health Worker, "Any image suspicious?"→"Suspicious / Non-suspicious"). Use `readObs(obs, ref)` — it reads by primary name and falls back through `legacyNames` — so both new and pre-2.0 encounters parse. UUIDs are only needed for endpoints that take one (e.g. `/web/concept/{uuid}`).

### The review submit flow
`src/forms/ReviewForm.tsx` is the core. It loads the review encounter, its subject, and the subject's latest completed Oral Screening in parallel (`loadReview`). Submitting **transitions the already-scheduled review encounter** via `PUT /api/encounter/{uuid}` (see `submitEncounter` in `src/api/encounters.ts`) — it does not create a new one, so the same row is completed rather than duplicated.

Two server NPE workarounds live in `src/api/encounters.ts` and must be preserved: every write sends `cancelObservations: {}` (and schedules send `observations: {}`) because avni-server unconditionally dereferences those fields and 500s on null.

### Diagnosis is auto-derived, not free-picked
`src/forms/diagnosisMapping.ts` encodes the clinical decision table: a chosen **Provisional diagnosis** (and, for "Non-homogeneous leukoplakia", a dependent **sub-type**) deterministically derives **Classification** (Suspicious/Non-Suspicious), **Risk band**, and **Recommended action** — all shown read-only. Separately, Classification is *also* computed from the per-photo verdicts and used to filter which diagnoses are offered. The string literals in this file are exact answer-concept names from the bundle; casing drift silently breaks the mapping — do not "tidy" them.

A **High Risk** diagnosis additionally schedules a "High Risk Follow-up" encounter for the field worker (`ensureHighRiskFollowUp`), guarded against duplicates.

### Photos: two capture models + two special paths
Oral Screening photos arrive in one of two repeatable QuestionGroups (`ORAL_IMAGE_GROUP` or `ORAL_SCREENING_GROUP`, chosen by the "Do you see any lesions?" branch), each an array of `{ "Oral Image": <url>, … }`. `collectPhotos` normalises both into slots 1..8, falling back to the legacy flat `Photo N (image)` keys. Two paths bypass the normal photo-review UI:
- **Legacy flat-layout screenings** (`isLegacyOralScreening`) are shown read-only with a warning — not reviewable.
- **Limited mouth opening** (`Able to Open Mouth? === "No"`) carries no photos by design; the whole Diagnosis section is pre-populated with the fixed `LIMITED_MOUTH_REVIEW` values and the clinician only writes Notes.

Verdicts are written back into the review's own repeatable `Images` QuestionGroup (`REVIEW_IMAGE_GROUP`), one row per photo carrying the copied media URL so the mobile dashboard can render thumbnails.

### Media URLs are S3-presigned and expire
`src/api/media.ts`: photo observations hold either a bare filename (still uploading — `isPendingMediaUpload`) or a full S3 URL that must be signed via `/media/signedUrl`. Signed URLs are cached with a 10-minute TTL (shorter than S3's ~15–60 min expiry); `MediaImg`'s `onError` evicts and re-signs to recover from mid-window expiry (CPG-2163).

### Auth
Multi-provider (Cognito + Keycloak) selected at runtime from `GET /idp-details` via `createIdpClient` (`src/auth/IdpFactory.ts`). `AuthProvider` orchestrates the load→restore-session→`/me` flow with cancellation guards; a shared axios instance (`src/auth/httpClient.ts`) attaches the auth header through a request interceptor bound via `bindIdp`. Routes are gated in `App.tsx`: only users in the **"Physician"** user group (`src/auth/roles.ts`) reach the review UI; others get `NotAuthorized`.

### Server-side extension endpoints
The list view relies on custom `/api/impl/*` endpoints (`src/api/impl.ts`): `catchmentLocations` (cached per session) and `encountersWithLocation`, which joins encounters to subject location and supports a linked-observation filter (used to filter pending reviews by referral facility). These are not stock Avni endpoints — the Tanuh server must provide them.

## Conventions & gotchas
- Path alias `@/` → `src/`.
- Dev proxy forwards a fixed prefix list (`/api`, `/me`, `/web`, `/media`, `/idp-details`, `/cognito-details`) to `VITE_AVNI_PROXY_TARGET` (falls back to `VITE_AVNI_API_BASE_URL`); add new upstream prefixes to `vite.config.ts`.
- In-progress review form state is persisted to `sessionStorage` per encounter UUID (survives refresh/HMR), cleared on successful submit.
- The review UI is deliberately **name-blind** — patient name is never shown; cases are titled by external/Case ID.
- Concept answer lists are fetched from `/web/concept/{uuid}` and cached (`src/api/concepts.ts`), filtering voided answers.

## Avni-side prerequisites
The Tanuh org instance must have (from the `Tanuh_UAT` bundle): the Person subject type, "Oral Screening" and "Clinician Review Form" encounter types, "Patient Registration" form; a visit-schedule rule that schedules a review encounter when an Oral Screening completes; a "Physician" user group with privileges on the review encounter type; and each physician assigned the catchments they review. The "High Risk Follow-up" encounter type and the custom `/api/impl/*` endpoints must also be deployed.

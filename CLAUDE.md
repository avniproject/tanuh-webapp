# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Setup
cp .env.example .env
# Edit VITE_AVNI_API_BASE_URL to point at target Avni server
npm install

# Development
npm run dev          # Start dev server on port 3010
npm run build        # Build for production (outputs to dist/)
npm run preview      # Preview production build
npm run lint         # Run ESLint with zero warnings policy
npm run typecheck    # Run TypeScript type checking
```

## Project Architecture

This is a React 18 + TypeScript physician review webapp that sits on top of Avni Web APIs. It uses Material UI v7 and Vite for building.

### Authentication System
- Multi-provider auth supporting both Cognito and Keycloak via `/idp-details` endpoint
- Auth flow reuses pattern from `avni-webapp`
- IdpFactory (`src/auth/IdpFactory.ts`) determines which provider to use based on server response
- Session restoration handles race conditions between Cognito session checks and signIn calls
- Role-based access requiring "Physician" user group membership

### Key Architectural Patterns
- **API Layer**: TypeScript interfaces in `src/api/` define Avni server response shapes
- **Observations**: Keyed by concept *name* (not UUID) - use display names when looking up values
- **State Management**: React Context for auth, no external state library
- **Routing**: Role-gated routes with automatic redirects for unauthorized users
- **Form Handling**: Material UI components with date-fns for date operations

### Directory Structure
- `src/auth/` - Authentication providers, IdP clients, role checking
- `src/api/` - API response types and data fetching functions  
- `src/components/` - Reusable UI components
- `src/forms/` - Form components (ReviewForm, OPMD options)
- `src/pages/` - Route components (ReviewListPage, ReviewDetail, etc)
- `src/constants/` - Tanuh-specific concept definitions
- `src/hooks/` - Custom React hooks
- `src/theme/` - Material UI theme configuration

### Development Configuration
- Vite dev server proxies API calls to avoid CORS issues
- Proxy target configurable via `VITE_AVNI_PROXY_TARGET`
- TypeScript with strict settings and ESLint with zero warnings policy
- Path alias `@/` points to `src/` directory

### Avni Integration Requirements
- Tanuh org must have specific subject types, forms, and encounter types from `Tanuh_UAT` bundle
- Requires visit-schedule rule creating "Physician Review Form" encounters after "Oral Screening"
- Physician users need "Physician" group membership and appropriate catchment assignments
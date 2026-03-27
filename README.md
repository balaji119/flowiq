# FlowIQ

Monorepo for the FlowIQ quote workflow. The frontend lives in `apps/web` as a Next.js app, and the backend lives in `apps/api` as a Go service backed by PostgreSQL.

## Repository Layout

```text
flowiq/
|-- apps/
|   |-- web/        # Next.js frontend
|   `-- api/        # Go backend
|-- packages/
|   |-- shared/     # shared types, constants, utils
|   `-- ui/         # reusable UI components
|-- infra/
|   |-- docker/     # container assets
|   `-- scripts/    # deployment helper scripts
|-- docs/
|-- .env.example
`-- package.json
```

## What is included

- `apps/web`: Next.js frontend with the quote, auth, and admin flows.
- `apps/web`: Next.js frontend with the campaign landing page, quote, auth, and admin flows.
- `apps/api`: Go API for JWT auth, tenant-scoped campaign persistence, calculator logic, PrintIQ integration, admin management, and purchase-order uploads.
- `packages/shared`: shared types, constants, and payload/calculation utilities.
- `packages/ui`: reusable UI primitives used by the frontend.
- `infra`: Docker and script assets for deployment support.

## Calculation source

- The app now reads quantity data from the checked-in workbook metadata snapshot.
- The active calculation comes from the workbook `V-LOOKUP` ranges and the schedule-style run selection.
- The `Installs` sheet is still ignored.
- PrintIQ product setup fields are still configurable in the app because the workbook only covers the schedule quantity logic.

## Setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL locally and set `DATABASE_URL`.
3. Fill in the PrintIQ credentials.
4. Install dependencies with `npm install`.
5. Run the database setup with `npm run db:setup`.
6. Start the Go API with `npm run start:api`.
7. Start the frontend with `npm run web` or `npm run dev`.

The default local URLs are:

- web: `http://localhost:3000`
- API: `http://localhost:4000`

## Commands

- `npm run dev`
- `npm run web`
- `npm run dev:api`
- `npm run start:api`
- `npm run build`
- `npm run serve`
- `npm run start:all`
- `npm run typecheck`
- `npm run db:migrate`
- `npm run db:seed`
- `npm run db:setup`

## Architecture

- `apps/web/app/page.tsx`: Next.js route entry point
- `apps/web/App.tsx`: client-side application shell
- `apps/web/src/screens/QuoteBuilderScreen.tsx`: primary shared UI
- `apps/web/src/services/campaignApi.ts`: persisted campaign workflow client
- `packages/shared/src/campaign.ts`: workbook-total helpers
- `packages/shared/src/printiq.ts`: form-to-PrintIQ payload mapper
- `apps/api/db/migrations/001_initial.sql`: initial PostgreSQL schema
- `apps/api/calculator.go`: workbook parser and quantity calculator
- `apps/api/main.go`: Go API entry point

## Workflow Persistence

- Campaigns are now stored in PostgreSQL with `draft`, `calculated`, and `submitted` states.
- Every core table is tenant-scoped through `tenant_id`.
- Users authenticate with JWT and only see data for their tenant.
- Supported user roles are `super_admin`, `admin`, and `user`.
- The main persisted workflow endpoints are:
  - `POST /api/campaigns`
  - `GET /api/campaigns/{id}`
  - `PUT /api/campaigns/{id}`
  - `POST /api/campaigns/{id}/calculate`
  - `POST /api/campaigns/{id}/submit-to-printiq`

## Seed Data

- `npm run db:seed` always creates the default tenant plus the `super_admin` account from `SUPER_ADMIN_*`.
- If `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` are set, it also seeds a tenant `admin`.
- If `DEFAULT_USER_EMAIL` and `DEFAULT_USER_PASSWORD` are set, it also seeds a tenant `user`.

## Contributing

Contribution guidelines live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Deployment

- Linux deployment guide: [linux-deployment.md](docs/linux-deployment.md)
- Deployment update checklist: [deployment-update-checklist.md](docs/deployment-update-checklist.md)

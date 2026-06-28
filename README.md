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

- Quantity mappings are now stored in PostgreSQL per tenant.
- The schedule calculator reads market and asset quantity mappings from the database at runtime.
- Admin and `super_admin` users can manage mappings in the app and can download, edit, and re-import the current mappings as CSV, including new records and custom quantity columns.
- PrintIQ product setup fields are still configurable in the app because the mapping dataset only covers schedule quantity logic.

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

## OneDrive artwork imports

The artwork upload manager supports both the existing local PDF upload/drag-and-drop flow and a server-side OneDrive import flow. To enable OneDrive imports:

1. Register a Single-page application in Microsoft Entra ID.
2. Add the FlowIQ MSAL bridge URL (for example `http://localhost:3000/redirect`) as a SPA redirect URI. Production uses the same `/redirect` path on the public HTTPS origin.
3. Add the delegated Microsoft Graph `Files.Read` permission.
4. Set `ONEDRIVE_CLIENT_ID` in the API environment. Set `ONEDRIVE_TENANT_ID` to the tenant ID for a single-tenant app, or leave the default `organizations` for a multi-tenant work/school app.

OneDrive imports are tracked as database jobs. The API downloads the selected PDF directly, resumes interrupted HTTP transfers where the source supports ranges, and renders artwork pages on the server. If the API itself restarts, an active job is marked failed so the user can start it again cleanly. The production API image includes Poppler (`pdfinfo` and `pdftoppm`) for this processing. Local API development requires those commands to be installed and available on `PATH` before a OneDrive import can be processed.

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

## Theme Quick-Change (Frontend)

To quickly change the app theme color, edit global tokens in:

- `apps/web/app/globals.css`

Primary theme tokens live under `:root`:

- `--primary-500` and `--primary-500-rgb`: main brand/button color
- `--primary-400` and `--primary-400-rgb`: hover/accent shade
- `--primary-300`, `--primary-200`, `--primary-100`: lighter accents
- `--primary-600`, `--primary-700`, `--primary-800`, `--primary-900`: darker shades

Where these are used globally:

- `.btn-theme-primary` uses `--primary-500`, `--primary-400`, and RGB vars
- `body` background gradients use `--primary-500-rgb` and `--primary-400-rgb`
- `::selection` uses `--primary-500-rgb`

Quick purple-to-teal example:

```css
:root {
  --primary-500: #0ea5a4;
  --primary-500-rgb: 14, 165, 164;
  --primary-400: #2dd4bf;
  --primary-400-rgb: 45, 212, 191;
}
```

After updating tokens, restart `npm run web` (or refresh the running app) to verify button, hover, and background updates.

## Architecture

- `apps/web/app/page.tsx`: Next.js route entry point
- `apps/web/App.tsx`: client-side application shell
- `apps/web/src/screens/QuoteBuilderScreen.tsx`: primary shared UI
- `apps/web/src/services/campaignApi.ts`: persisted campaign workflow client
- `packages/shared/src/campaign.ts`: quantity-total helpers
- `packages/shared/src/printiq.ts`: form-to-PrintIQ payload mapper
- `apps/api/db/migrations/001_initial.sql`: initial PostgreSQL schema
- `apps/api/db/migrations/002_calculator_mappings.sql`: calculator mapping schema
- `apps/api/calculator.go`: database-backed quantity calculator
- `apps/api/mapping_store.go`: calculator mapping persistence and JSON import support
- `apps/api/main.go`: Go API entry point

## Workflow Persistence

- Campaigns are now stored in PostgreSQL with `draft`, `calculated`, and `submitted` states.
- Every core table is tenant-scoped through `tenant_id`.
- Users authenticate with JWT and only see data for their tenant.
- Supported user roles are `super_admin`, `admin`, and `user`.
- Calculator mappings are tenant-scoped and are loaded through admin-managed database records instead of local files.
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
- Calculator mappings are not seeded. Use the admin mapping import flow to download the CSV template and load your starting data.

## Contributing

Contribution guidelines live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Deployment

- Linux deployment guide: [linux-deployment.md](docs/linux-deployment.md)
- Deployment update checklist: [deployment-update-checklist.md](docs/deployment-update-checklist.md)

Production note:

- The frontend should call same-origin `/api/*` routes behind the reverse proxy.
- The main Docker app stack lives in `infra/docker/docker-compose.yml`.
- PostgreSQL is internal to the Docker network in the checked-in compose file.
- After Linux deploy/reset, run DB bootstrap inside the `api` container:
  - `docker compose -f infra/docker/docker-compose.yml exec -T api ./flowiq-api migrate`
  - `docker compose -f infra/docker/docker-compose.yml exec -T api ./flowiq-api seed`

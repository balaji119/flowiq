# FlowIQ

Web application for capturing campaign print schedule inputs, calculating workbook-based poster and frame quantities, and sending a PrintIQ quote request through a secure proxy.

## What is included

- Browser-based FlowIQ interface built with Next.js and `react-native-web`.
- Shared form for campaign scheduling, quote details, operations, and contact details.
- Workbook-derived calculator data checked into the repo for runtime use.
- Node/Express proxy to request the PrintIQ token and submit `GetPrice`.
- PrintIQ payload preview so the business mapping is visible before submission.

## Calculation source

- The app now reads quantity data from the checked-in workbook metadata snapshot.
- The active calculation comes from the workbook `V-LOOKUP` ranges and the schedule-style run selection.
- The `Installs` sheet is still ignored.
- PrintIQ product setup fields are still configurable in the app because the workbook only covers the schedule quantity logic.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in the PrintIQ credentials.
3. Install dependencies with `npm install`.
4. Start the proxy with `npm run start:server`.
5. Start the Next.js frontend with `npm run web` or `npm run dev`.

## Commands

- `npm run dev`
- `npm run web`
- `npm run build`
- `npm run serve`
- `npm run start:server`
- `npm run start:all`
- `npm run typecheck`

## Architecture

- `app/page.tsx`: Next.js route entry point
- `App.tsx`: client-side application shell
- `src/screens/QuoteBuilderScreen.tsx`: primary shared UI
- `src/utils/campaign.ts`: workbook-total helpers
- `src/utils/printiq.ts`: form-to-PrintIQ payload mapper
- `src/services/calculatorApi.ts`: workbook calculator API wrapper
- `src/services/quoteApi.ts`: client API wrapper
- `server/workbookCalculator.js`: workbook parser and quantity calculator
- `server/index.js`: calculator and PrintIQ proxy

## Deployment

- Linux mini PC deployment guide: [linux-mini-pc-deployment.md](/C:/Users/BKanagaraju/Documents/FlowIQ/docs/linux-mini-pc-deployment.md)
- Deployment update checklist: [deployment-update-checklist.md](/C:/Users/BKanagaraju/Documents/FlowIQ/docs/deployment-update-checklist.md)

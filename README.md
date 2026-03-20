# FlowIQ

Shared React Native + Expo application for web and mobile that captures printing order inputs for ADS Australia / Revolution360, calculates an estimated quote in-app, and sends a PrintIQ quote request through a secure proxy.

## What is included

- Expo app that runs on web, Android, and iOS from one codebase.
- Shared form for customer, product spec, operations, and contact details.
- In-app estimate calculator based on inferred spreadsheet-style inputs.
- Node/Express proxy to request the PrintIQ token and submit `GetPrice`.
- PrintIQ payload preview so the business mapping is visible before submission.

## Important assumption

The Excel workbook referenced in the requirement was not present in the project workspace when this app was created. Because of that:

- The calculator logic in `src/utils/calculations.ts` is an inferred first pass.
- The stock codes, rates, and operation costs in `src/constants.ts` are editable placeholders.
- The `installs` tab has been ignored as requested.

Once the actual workbook is added, the next step is to map the exact formulas and lookup tables into the calculator module.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in the PrintIQ credentials.
3. Install dependencies with `npm install`.
4. Start the proxy with `npm run start:server`.
5. Start the Expo app with `npm run web` or `npm run start`.

## Commands

- `npm run web`
- `npm run android`
- `npm run ios`
- `npm run start:server`
- `npm run start:all`
- `npm run typecheck`

## Architecture

- `App.tsx`: app entry point
- `src/screens/QuoteBuilderScreen.tsx`: primary shared UI
- `src/utils/calculations.ts`: estimated pricing logic
- `src/utils/printiq.ts`: form-to-PrintIQ payload mapper
- `src/services/quoteApi.ts`: client API wrapper
- `server/index.js`: PrintIQ proxy

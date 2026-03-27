# Contributing

Thanks for contributing to FlowIQ.

## Before You Start

- Use Node.js 22+ and Go 1.25+.
- Copy `.env.example` to `.env` if you need to run the app locally.
- Install dependencies with `npm install`.

## Local Development

Run the frontend:

```bash
npm run web
```

Run the API:

```bash
npm run start:api
```

Run both together:

```bash
npm run start:all
```

## Validation

Before opening a pull request, run:

```bash
npm run typecheck
npm run build
```

## Project Structure

- `apps/web`: Next.js frontend
- `apps/api`: Go backend
- `packages/shared`: shared types and business logic helpers
- `packages/ui`: reusable frontend UI primitives
- `docs`: project and deployment documentation

## Pull Requests

- Keep changes focused and scoped to the task.
- Update documentation when behavior, setup, or structure changes.
- Avoid committing generated runtime files such as local auth stores, upload files, logs, or build artifacts.
- Include a short summary of what changed and how you verified it.

## Reporting Issues

If you open an issue, include:

- what you expected to happen
- what actually happened
- reproduction steps
- screenshots or logs when useful

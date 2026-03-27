# Linux Mini PC Deployment

This deployment setup is designed for a Linux mini PC hosting:

- the Next.js web build
- the Node/Express API
- Caddy as the public HTTPS reverse proxy
- optionally DuckDNS for direct public DNS
- or Cloudflare Tunnel for public access behind CGNAT

## What Gets Deployed

- `web-builder`
  - builds the Next.js frontend into `dist-web`
- `api`
  - runs the backend from `server/index.js`
- `caddy`
  - serves the web app and proxies `/api/*` to the backend
- `duckdns`
  - keeps your DuckDNS subdomain pointed to your current public IP

If you are using Cloudflare Tunnel in production:

- `cloudflared` runs outside Docker as a Linux service
- public traffic goes through Cloudflare Tunnel to `http://localhost:80`
- Caddy serves the app locally on port `80`

## Files

- [Dockerfile.api](/C:/Users/BKanagaraju/Documents/FlowIQ/Dockerfile.api)
- [docker-compose.yml](/C:/Users/BKanagaraju/Documents/FlowIQ/deploy/docker-compose.yml)
- [Caddyfile](/C:/Users/BKanagaraju/Documents/FlowIQ/deploy/Caddyfile)
- [update-duckdns.sh](/C:/Users/BKanagaraju/Documents/FlowIQ/deploy/duckdns/update-duckdns.sh)
- [.env.production.example](/C:/Users/BKanagaraju/Documents/FlowIQ/deploy/.env.production.example)

## Before You Start

1. Install Docker and Docker Compose on the Linux mini PC.
2. Copy the project to the mini PC.
3. Make sure this file exists on the mini PC:
   - `deploy/.env.production`
4. Forward router ports `80` and `443` to the mini PC if you are using direct public access.

If you are using Cloudflare Tunnel instead:

- router port forwarding is not required
- make sure the `cloudflared` service is configured and running

## Production Env File

Create:

`deploy/.env.production`

You can start from:

`deploy/.env.production.example`

Important values:

- `DOMAIN`
  - your DuckDNS hostname, for example `flowiq-demo.duckdns.org`
- `PRINTIQ_*`
  - backend credentials for PrintIQ
- `DUCKDNS_SUBDOMAIN`
  - the subdomain portion only, for example `flowiq-demo`
- `DUCKDNS_TOKEN`
  - your DuckDNS token

## Build The Web App

Run this once after pulling changes, and again whenever frontend code changes:

```bash
cd deploy
docker compose run --rm web-builder
```

This creates:

`dist-web`

## Start The Stack

```bash
cd deploy
docker compose up -d --build api caddy duckdns
```

If you are using Cloudflare Tunnel instead of DuckDNS for public access, use:

```bash
cd deploy
docker compose up -d --build api
docker compose up -d --force-recreate caddy
```

## Update The App

When you deploy a new version:

1. pull the latest code
2. rebuild the web app
3. rebuild the API image
4. restart the services

```bash
cd deploy
docker compose run --rm web-builder
docker compose up -d --build api
docker compose up -d --force-recreate caddy
```

## Logs

Check service logs:

```bash
cd deploy
docker compose logs -f api
docker compose logs -f caddy
docker compose logs -f duckdns
```

If you are using Cloudflare Tunnel, also check:

```bash
sudo systemctl status cloudflared --no-pager
sudo journalctl -u cloudflared -n 100 --no-pager
```

Application quote request logs are written to:

`logs/printiq-payloads.log`

## Notes

- The web build uses `NEXT_PUBLIC_API_BASE_URL=/api`, so browser requests go through Caddy to the backend on the same domain.
- The calculator now uses the checked-in JSON snapshot in `server/workbookMetadata.json`, so the Excel workbook is not required at runtime.
- If you want to change the public hostname later, update `DOMAIN` and DuckDNS settings, then restart the stack.
- If you are using Cloudflare Tunnel, make sure `cloudflared` is configured as a system service and that Caddy is recreated with `docker compose up -d --force-recreate caddy` after frontend deployments.

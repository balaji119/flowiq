# Deployment Update Checklist

This guide explains what to do on the Ubuntu deployment server when a new version of the code is released.

It assumes:

- the app is already deployed on the Linux mini PC
- Docker and Docker Compose are already installed
- the server is accessed over SSH

## When To Use This

Use this whenever:

- a new code change is pushed to GitHub
- frontend behavior changes
- backend logic changes
- deployment files change

## Standard Update Steps

SSH into the server:

```bash
ssh balaji@your-server-ip
```

Go to the project:

```bash
cd ~/flowiq
```

Pull the latest code:

```bash
git pull
```

Go to the deployment folder:

```bash
cd deploy
```

Rebuild the web app:

```bash
docker compose run --rm web-builder
```

Rebuild and restart the backend and Caddy:

```bash
docker compose up -d --build api caddy
```

If DuckDNS is still part of your deployment, include it too:

```bash
docker compose up -d --build api caddy duckdns
```

## If You Are Using Cloudflare Tunnel

If Cloudflare Tunnel is running separately with `cloudflared`, you normally do not need to rebuild or restart it for app code changes.

Only restart it if:

- tunnel config changed
- domain/hostname changed
- service configuration changed

## Quick Verification

Check containers:

```bash
docker compose ps
```

Check API logs:

```bash
docker compose logs --tail=100 api
```

Check Caddy logs:

```bash
docker compose logs --tail=100 caddy
```

If needed, verify health locally:

```bash
curl http://localhost:80/api/health
```

## If Frontend Changes Are Not Visible

If the site still shows old UI after a release:

1. rebuild the web bundle again
2. recreate Caddy
3. refresh browser with cache disabled
4. purge Cloudflare cache if Cloudflare is caching an old asset

Useful commands:

```bash
cd ~/flowiq/deploy
docker compose run --rm web-builder
docker compose up -d --force-recreate caddy
```

## If Backend Changes Are Not Visible

Rebuild the API container:

```bash
cd ~/flowiq/deploy
docker compose up -d --build api
```

## Full Safe Update Flow

```bash
ssh balaji@your-server-ip
cd ~/flowiq
git pull
cd deploy
docker compose run --rm web-builder
docker compose up -d --build api caddy
docker compose ps
docker compose logs --tail=50 api
docker compose logs --tail=50 caddy
```

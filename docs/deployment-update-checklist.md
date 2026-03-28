# Deployment Update Checklist

Use this when a new FlowIQ version is pushed and you need to refresh the Linux deployment.

This checklist assumes you are using the current checked-in Docker setup in `infra/docker/docker-compose.yml`, which runs the `postgres`, `api`, and `web` services.
If you use a separate reverse proxy such as Caddy, make sure it points to the current `web` and `api` services instead of an older static deployment directory.

## Standard Update

```bash
ssh balaji@your-server-ip
cd ~/flowiq
git pull
docker compose -f infra/docker/docker-compose.yml down
docker compose -f infra/docker/docker-compose.yml up -d --build
```

## Verification

```bash
docker compose -f infra/docker/docker-compose.yml ps
docker compose -f infra/docker/docker-compose.yml logs --tail=100 api
docker compose -f infra/docker/docker-compose.yml logs --tail=100 web
curl http://localhost:4000/api/health
curl -I http://localhost:3000
```

If you front the app with Caddy, also verify that:

- `/` proxies to `web:3000`
- `/api/*` proxies to `api:4000`
- the proxy is not serving an old static `dist-web` folder

## If Frontend Changes Are Missing

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml down
docker compose -f infra/docker/docker-compose.yml up -d --build web
```

Then confirm the browser is calling same-origin `/api/...` routes and not `http://api:4000/...`.

## If Backend Changes Are Missing

```bash
cd ~/flowiq
docker compose -f infra/docker/docker-compose.yml down
docker compose -f infra/docker/docker-compose.yml up -d --build api
```

## If The Public Domain Still Shows An Old UI

Check whether your reverse proxy is still serving a previous static deployment:

```bash
docker ps
docker logs deploy-caddy-1 --tail 50
```

If the domain still serves stale UI while `http://SERVER_IP:3000` shows the latest build, the problem is in the reverse proxy layer, not in the app containers.

## If The API Container Restarts In A Loop

```bash
docker compose -f infra/docker/docker-compose.yml logs --tail=100 api
```

The API image must contain `apps/api/db/migrations`. If you see `open db/migrations: no such file or directory`, rebuild with the latest checked-in [Dockerfile.api](../infra/docker/Dockerfile.api).

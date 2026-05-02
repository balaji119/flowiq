# Droplet Deployment Runbook (FlowIQ)

Use this runbook whenever you make code changes and want to deploy to the DigitalOcean Droplet.

## 1) Push code from local

```bash
git add .
git commit -m "describe your change"
git push
```

## 2) SSH into Droplet

```bash
ssh root@ip
cd /opt/flowiq
```

## 3) Pull latest code

```bash
git pull
```

## 4) (Recommended) Take pre-deploy DB backup

```bash
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.do.yml exec -T postgres \
  sh -lc "pg_dump -U flowiq -d flowiq -Fc -f /tmp/predeploy_$(date +%F_%H%M).dump"
```

## 5) Rebuild and restart app

```bash
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.do.yml up -d --build
```

## 6) Run database migration (if schema changed)

```bash
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.do.yml exec -T api ./flowiq-api migrate
```

Notes:
- Run this for any migration/DB-related code change.
- Do not run `seed` in normal production updates unless explicitly needed.

## 7) Verify health and logs

```bash
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.do.yml ps
curl http://localhost:4000/api/health
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.do.yml logs --tail=100 api
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.do.yml logs --tail=100 web
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.do.yml logs --tail=100 caddy
```

## 8) Smoke test in browser

Check:
- Login
- Dashboard
- User Management
- Quantity Mapping
- Shipping Address
- Shipping Cost
- Printing Cost
- Campaign calculate/submit flow

## 9) Fast rollback (if needed)

```bash
cd /opt/flowiq
git log --oneline -n 5
git checkout <previous_commit_hash>
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.do.yml up -d --build
```

If a DB migration caused the issue, restore from the pre-deploy dump in `/tmp/`.

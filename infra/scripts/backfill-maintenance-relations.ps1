param(
  [string]$ComposeFile = "infra/docker/docker-compose.yml"
)

$ErrorActionPreference = "Stop"

Write-Host "Running DB migrations..."
docker compose -f $ComposeFile exec -T api ./flowiq-api migrate

Write-Host "Backfilling maintenance relations..."
docker compose -f $ComposeFile exec -T api ./flowiq-api backfill-maintenance-relations

Write-Host "Done."

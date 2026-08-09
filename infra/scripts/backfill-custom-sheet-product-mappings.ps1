param(
  [string]$ComposeFile = "infra/docker/docker-compose.yml"
)

$ErrorActionPreference = "Stop"

Write-Host "Running DB migrations..."
docker compose -f $ComposeFile exec -T api ./flowiq-api migrate

Write-Host "Backfilling custom sheet product mappings..."
docker compose -f $ComposeFile exec -T api ./flowiq-api backfill-custom-sheet-product-mappings

Write-Host "Done."

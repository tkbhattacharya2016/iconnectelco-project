#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# seed-catalog.sh
#
# Uploads catalog JSON and placeholder images to Azure Blob Storage so the
# /api/catalog endpoint has something to serve on first deploy.
#
# Prerequisites:
#   - Azure CLI (az) logged in:   az login
#   - Storage account exists (created by infrastructure/modules/storage-account.bicep)
#   - Your account has Storage Blob Data Contributor role on the account
#
# Usage:
#   ./seed-catalog.sh <storage-account-name> <container-name>
#
# Example:
#   ./seed-catalog.sh iconnectelcocatalog catalog
# -----------------------------------------------------------------------------

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <storage-account-name> <container-name>"
  exit 1
fi

STORAGE_ACCOUNT="$1"
CONTAINER="$2"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "Uploading catalog metadata to ${STORAGE_ACCOUNT}/${CONTAINER}..."

# Upload metadata JSON
for file in devices.json accessories.json bundles.json plans.json; do
  echo "  -> ${file}"
  az storage blob upload \
    --account-name "${STORAGE_ACCOUNT}" \
    --container-name "${CONTAINER}" \
    --name "metadata/${file}" \
    --file "${SCRIPT_DIR}/${file}" \
    --auth-mode login \
    --overwrite \
    --content-type "application/json" \
    --content-cache "public, max-age=300" \
    > /dev/null
done

echo ""
echo "✓ Catalog metadata uploaded."
echo ""
echo "Next steps:"
echo "  1. Your merchandising team uploads product images to:"
echo "     ${STORAGE_ACCOUNT}/${CONTAINER}/devices/{sku}/main.webp"
echo "     ${STORAGE_ACCOUNT}/${CONTAINER}/accessories/{sku}/main.webp"
echo ""
echo "  2. Images should be served via the Azure CDN / Front Door endpoint:"
echo "     https://cdn.iconnectelco.com/devices/{sku}/main.webp"
echo ""
echo "  3. Verify the catalog endpoint is serving data:"
echo "     curl https://<your-swa-domain>.azurestaticapps.net/api/catalog"

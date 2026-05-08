# Azure setup — end-to-end hosting walkthrough

Step-by-step instructions for deploying iConnecTelco to Azure for the first time. Read top-to-bottom; skip nothing.

For a higher-level view of what's being deployed, see [README.md](./README.md). For ongoing operations once it's live, see [DEPLOYMENT.md](./DEPLOYMENT.md). For Pega specifics, see [PEGA-INTEGRATION.md](./PEGA-INTEGRATION.md).

**Total time:** ~60 minutes for a first-time deploy, end to end.

---

## Pre-requisites — one-time setup

### On a developer machine

1. Install the Azure CLI:
   - **Windows:** `winget install Microsoft.AzureCLI`
   - **macOS:** `brew install azure-cli`
   - **Linux:** `curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash`
2. Install Node.js 20 LTS:
   - `winget install OpenJS.NodeJS.LTS` or download from [nodejs.org](https://nodejs.org/)
3. Install Azure Functions Core Tools v4:
   - `npm install -g azure-functions-core-tools@4 --unsafe-perm true`
4. Install Bicep CLI:
   - `az bicep install`
5. Log in:
   - `az login` — opens a browser, pick the right tenant
6. Verify subscription:
   - `az account show` — confirm you're in the right one
   - Switch with `az account set --subscription "<name-or-id>"` if not

### In your organization

1. Confirm your Azure account has the **Contributor** role on the target subscription (or scoped to a resource group your admin pre-creates for you).
2. Confirm your Microsoft Entra ID tenant ID:
   - `az account show --query tenantId -o tsv`
3. Get your own Entra object ID:
   - `az ad signed-in-user show --query id -o tsv`
   - You'll need this for Key Vault access.

### From Pega (do this in parallel — your Pega admin handles it)

1. Create an OAuth 2.0 client registration in your Pega tenant with `client_credentials` grant type.
2. Capture the `client_id`, `client_secret`, and the Pega base URL.
3. Confirm the seven case types exist:
   - `CT-ACT-NEW`, `CT-UPG-NEW`, `CT-SIM-SWAP`, `CT-PLAN-CHG`, `CT-PORT-IN`, `CT-BUNDLE`, `CT-ORDER`
   - If any are missing, file a ticket with your Pega team to create them.

---

## Step 1 — Get the project into a Git repository

The GitHub Actions workflow assumes the project lives in a Git repo (GitHub specifically — Azure DevOps and GitLab also work but need a different workflow file).

```bash
unzip iconnectelco-project.zip
cd iconnectelco-project
git init
git add .
git commit -m "Initial commit"

# Create the repo on GitHub (use the GitHub CLI or the web UI)
gh repo create iconnectelco --private --source . --push

# OR manually:
#   1. Create empty repo on github.com
#   2. git remote add origin git@github.com:your-org/iconnectelco.git
#   3. git branch -M main
#   4. git push -u origin main
```

## Step 2 — Edit the parameters file

Open `infrastructure/parameters/dev.parameters.json` and replace three values:

```json
{
  "tenantId": { "value": "your-tenant-id-from-az-account-show" },
  "keyVaultAdminObjectId": { "value": "your-object-id-from-prereqs" },
  "pegaBaseUrl": { "value": "https://your-tenant.pegacloud.net" }
}
```

Commit:

```bash
git add infrastructure/parameters/dev.parameters.json
git commit -m "Configure dev parameters"
git push
```

## Step 3 — Provision the infrastructure with Bicep

This creates everything except the GitHub-to-SWA wiring (which happens in step 4).

```bash
cd infrastructure
az deployment sub create \
  --location eastus \
  --template-file main.bicep \
  --parameters parameters/dev.parameters.json \
  --name iconnectelco-dev-initial
```

Takes about **8-12 minutes** and creates:

- **Resource group:** `rg-iconnectelco-dev`
- **Storage account:** `iconnectelcodevcat` (with the `catalog` blob container)
- **Key Vault:** `kv-iconnectelco-dev-<random>` (with placeholder Pega secrets)
- **Static Web App:** `swa-iconnectelco-dev` (empty — no code deployed yet)
- **Front Door:** `fd-iconnectelco-dev` profile + endpoint
- **Application Insights** + **Log Analytics workspace**

When it finishes, capture the outputs:

```bash
az deployment sub show \
  --name iconnectelco-dev-initial \
  --query properties.outputs
```

You'll see `staticWebAppDefaultHostname`, `keyVaultName`, `storageAccountName`, etc. Note the Static Web App name — you'll need it next.

## Step 4 — Get the Static Web App deployment token

The GitHub workflow uses this token to push code into the SWA.

```bash
az staticwebapp secrets list \
  --name swa-iconnectelco-dev \
  --query "properties.apiKey" -o tsv
```

Copy the long token string. In GitHub:

1. Go to your repo → **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`
4. Value: paste the token
5. Save

## Step 5 — Trigger the first deployment

```bash
# Make any change (or just an empty commit) to trigger the workflow
git commit --allow-empty -m "Trigger first deploy"
git push origin main
```

In GitHub, go to **Actions** tab — you'll see a workflow run start. Takes about **3-4 minutes**. When it finishes green, your app is live at the URL from step 3's `staticWebAppDefaultHostname` output.

Verify:

```bash
SWA_HOSTNAME="$(az deployment sub show --name iconnectelco-dev-initial --query properties.outputs.staticWebAppDefaultHostname.value -o tsv)"
curl https://$SWA_HOSTNAME/api/health
```

You should see `{"status":"ok","mode":"live","timestamp":"..."}`. The mode says `live` because that's the default — but Pega calls will fail until step 6 because the credentials are still placeholders.

## Step 6 — Put real Pega credentials in Key Vault

This is **the only step where secrets are touched**. Never put these in code or commit them.

```bash
KV_NAME="$(az deployment sub show --name iconnectelco-dev-initial --query properties.outputs.keyVaultName.value -o tsv)"

az keyvault secret set \
  --vault-name "$KV_NAME" \
  --name PegaClientId \
  --value "<paste-real-pega-client-id>"

az keyvault secret set \
  --vault-name "$KV_NAME" \
  --name PegaClientSecret \
  --value "<paste-real-pega-client-secret>"

az keyvault secret set \
  --vault-name "$KV_NAME" \
  --name PegaBaseUrl \
  --value "https://your-real-tenant.pegacloud.net"
```

The Static Web App's app settings already reference these via Key Vault — the next request will pick up the new values automatically. To force-refresh, restart the SWA:

```bash
az staticwebapp restart \
  --name swa-iconnectelco-dev \
  --resource-group rg-iconnectelco-dev
```

Verify by triggering a real Pega case from the portal, or with curl:

```bash
curl -X POST https://$SWA_HOSTNAME/api/pega-case \
  -H "Content-Type: application/json" \
  -d '{"caseType":"CT-ACT-NEW","flowKey":"activation","content":{"email":"test@example.com","firstName":"Test","lastName":"User"}}'
```

A real Pega case ID (without `"simulated":true`) means it's working.

## Step 7 — Seed the catalog

```bash
cd ../catalog-seed
STORAGE_ACCOUNT="$(az deployment sub show --name iconnectelco-dev-initial --query properties.outputs.storageAccountName.value -o tsv)"
chmod +x seed-catalog.sh
./seed-catalog.sh "$STORAGE_ACCOUNT" catalog
```

This uploads `devices.json`, `accessories.json`, `bundles.json`, and `plans.json` to the blob storage. Your portal's `/api/catalog` endpoint reads from these.

## Step 8 — Configure Microsoft Entra ID for authentication

The Static Web App's auth integration needs an Entra app registration so users can sign in.

```bash
# Create the app registration
APP_ID=$(az ad app create \
  --display-name "iConnecTelco SWA Dev" \
  --web-redirect-uris "https://$SWA_HOSTNAME/.auth/login/aad/callback" \
  --query appId -o tsv)

# Create a client secret (valid 2 years)
APP_SECRET=$(az ad app credential reset \
  --id $APP_ID \
  --display-name "swa-auth" \
  --years 2 \
  --query password -o tsv)

# Store it in Key Vault
az keyvault secret set \
  --vault-name "$KV_NAME" \
  --name AadClientSecret \
  --value "$APP_SECRET"

# Add to Static Web App settings (Key Vault reference)
az staticwebapp appsettings set \
  --name swa-iconnectelco-dev \
  --setting-names \
    AAD_CLIENT_ID="$APP_ID" \
    AAD_CLIENT_SECRET="@Microsoft.KeyVault(VaultName=$KV_NAME;SecretName=AadClientSecret)"
```

Then edit `staticwebapp.config.json` line `openIdIssuer` to replace `<TENANT_ID>` with your real tenant ID, commit, and push:

```bash
cd ..
TENANT_ID=$(az account show --query tenantId -o tsv)
sed -i "s/<TENANT_ID>/$TENANT_ID/" staticwebapp.config.json
git add staticwebapp.config.json
git commit -m "Configure Entra tenant for auth"
git push
```

## Step 9 — Custom domains (production-only)

Skip if you're fine with the `.azurestaticapps.net` URL during dev.

### SWA custom domain (e.g. `portal.iconnectelco.com`)

1. In the Azure portal: **Static Web App → Custom domains → Add**
2. Choose "Custom domain on other DNS"
3. Azure gives you a TXT record value to verify ownership
4. Add the TXT to your DNS provider, wait for verification
5. Add a CNAME pointing your domain to the `azurestaticapps.net` hostname
6. Azure provisions a managed certificate (~15 min)

### CDN custom domain (`cdn.iconnectelco.com`)

1. In the Azure portal: **Front Door profile → Domains → Add a domain**
2. Same TXT verification + CNAME pattern
3. Wait for cert (~15 min)

## Step 10 — Upload product images to the CDN

This is your merchandising team's job. Per [CATALOG.md](./CATALOG.md):

```bash
# Example: upload an iPhone 17 Pro image
az storage blob upload \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name catalog \
  --name "devices/iphone-17-pro/main.webp" \
  --file ~/Downloads/iphone-17-pro.webp \
  --auth-mode login \
  --content-type image/webp \
  --content-cache "public, max-age=604800"
```

Repeat for each of the 8 phones, 6 accessories, and any bundle hero imagery. Use licensed assets from manufacturer partner portals (Apple MFi, Samsung Partner Hub, Google Partner Dashboard).

## Step 11 — Verify everything end-to-end

```bash
# 1. Health check shows live mode
curl https://$SWA_HOSTNAME/api/health

# 2. Catalog endpoint returns real data
curl https://$SWA_HOSTNAME/api/catalog | head -100

# 3. Open the portal in a browser
# (mac/linux)
open https://$SWA_HOSTNAME/
# (windows)
start https://$SWA_HOSTNAME/

# 4. Place a test order and verify a real case appears in Pega
```

Walk through: add an iPhone to cart → checkout autonomously → fill in details → place order → confirm in Pega's admin console that case `CT-ORDER C-XXXXXX` was created with the right line items.

---

## Promoting dev to production

When dev is stable, repeat steps 2-9 with `prod.parameters.json` instead. Same commands, different resource names (`rg-iconnectelco-prod` etc.) and different Pega credentials (your prod Pega tenant, not dev).

## Operational notes

### Toggling simulation mode (for demos without hitting real Pega)

```bash
az staticwebapp appsettings set \
  --name swa-iconnectelco-dev \
  --setting-names PEGA_MODE=simulated
```

To flip back:

```bash
az staticwebapp appsettings set \
  --name swa-iconnectelco-dev \
  --setting-names PEGA_MODE=live
```

### Viewing logs

```bash
az staticwebapp logs show --name swa-iconnectelco-dev
```

Or in the portal: **Static Web App → Monitoring → Log stream**.

### Rolling back a bad deploy

```bash
git revert <bad-commit>
git push origin main
# GitHub Actions redeploys the previous state automatically
```

### Updating Pega credentials after rotation

```bash
az keyvault secret set --vault-name "$KV_NAME" --name PegaClientSecret --value "<new>"
az staticwebapp restart --name swa-iconnectelco-dev --resource-group rg-iconnectelco-dev
```

### Estimating monthly Azure costs

Rough monthly burn for a dev environment at low traffic:

| Resource | Cost |
|---|---|
| Static Web App Standard | $9 |
| Azure Functions (consumption, within free tier) | $0 |
| Storage Account (Standard ZRS, 1 GB) | $0.50 |
| Front Door Standard | $35 |
| Key Vault (10 ops/day) | $0.10 |
| Application Insights (1 GB/mo) | $2 |
| **Total** | **~$47/month** |

Production scales with traffic. Budget $150-400/month for a live carrier site with modest traffic.

---

## Troubleshooting

### "Pega case creation failed: 401"

Your `PegaClientId` or `PegaClientSecret` value in Key Vault is wrong. Re-verify with your Pega admin and re-set the secret.

### "Pega case creation failed: 404"

The case type ID doesn't exist in your Pega tenant. Confirm the seven case types from the prerequisites.

### "Environment variable PEGA_CLIENT_ID is not configured"

The Key Vault reference isn't resolving. Three things to check:
1. The secret exists: `az keyvault secret show --vault-name $KV_NAME --name PegaClientId`
2. The Function App has Key Vault Secrets User role on the vault
3. The secret value isn't still `PUT_REAL_CLIENT_ID_HERE`

### GitHub Actions workflow fails with "Unauthorized"

The `AZURE_STATIC_WEB_APPS_API_TOKEN` secret in GitHub is missing or wrong. Re-run step 4.

### Sign-in returns "AADSTS50011: redirect URI mismatch"

The Entra app registration's redirect URI doesn't match the SWA hostname. Update it:

```bash
az ad app update --id $APP_ID --web-redirect-uris "https://$SWA_HOSTNAME/.auth/login/aad/callback"
```

### Catalog images not loading on the portal

Three things to check:
1. The image was actually uploaded: `az storage blob list --account-name $STORAGE_ACCOUNT --container-name catalog --prefix "devices/iphone-17-pro/"`
2. The CDN custom domain is verified (or use the auto-generated `*.azurefd.net` hostname)
3. The catalog JSON's `image` field URL matches what was uploaded

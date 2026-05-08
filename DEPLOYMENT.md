# Deployment guide

End-to-end walkthrough for deploying iConnecTelco to Azure. Assumes you have:

- An Azure subscription with Contributor access
- `az` CLI installed and logged in (`az login`)
- A GitHub repository containing this project
- A Microsoft Entra ID tenant for authentication
- Node.js 20 LTS installed locally (for running the API; skip if you're deploying without local testing)
- Azure Functions Core Tools v4 (`npm install -g azure-functions-core-tools@4`)

Total time: **~40 minutes** for a first-time deploy.

---

## Step 1 — Clone and inspect

```bash
git clone <your-repo-url>
cd iconnectelco-project
```

## Step 2 — Fill in deployment parameters

Edit `infrastructure/parameters/dev.parameters.json` (or `prod.parameters.json`) and replace:

- `tenantId` — your Entra ID tenant ID (find via `az account show --query tenantId -o tsv`)
- `keyVaultAdminObjectId` — your Entra ID user object ID (find via `az ad signed-in-user show --query id -o tsv`)
- `pegaBaseUrl` — your Pega tenant URL (example: `https://acme-dev.pegacloud.net`)

Do **not** put Pega client_id or client_secret here — those go in Key Vault separately (Step 6).

## Step 3 — Provision the infrastructure

```bash
cd infrastructure

az deployment sub create \
  --location eastus \
  --template-file main.bicep \
  --parameters parameters/dev.parameters.json
```

This creates a resource group containing:

- Static Web App
- Storage account + `catalog` blob container
- Key Vault (with placeholder Pega secrets)
- Front Door CDN profile
- Application Insights
- Log Analytics workspace

Takes ~8 minutes. At the end, note the outputs — you'll use `staticWebAppDefaultHostname` and `keyVaultName` below.

## Step 4 — Wire GitHub to Static Web Apps

Static Web Apps uses a GitHub Actions workflow for deployment. Get the deployment token:

```bash
az staticwebapp secrets list \
  --name swa-iconnectelco-dev \
  --query "properties.apiKey" -o tsv
```

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**

- Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`
- Value: the token from the command above

Then push to `main` (or merge a PR). The workflow at `.github/workflows/deploy.yml` will build and deploy both the frontend and the Python API.

## Step 5 — Verify it deployed

Open the URL from Step 3's output (something like `swa-iconnectelco-dev-abcde.azurestaticapps.net`). You should see the landing page with two app cards: Portal and CSR.

Also verify the health endpoint:

```bash
curl https://<your-swa-hostname>.azurestaticapps.net/api/health
```

Should return:

```json
{"status":"ok","mode":"live","timestamp":"2026-04-24T..."}
```

If `mode` says `live` but you haven't set real Pega credentials, the portal will error when a customer tries to place an order. Proceed to Step 6 before testing checkout.

## Step 6 — Put real Pega credentials in Key Vault

This is the **only step where secrets are handled**. Never put these in code or commit them.

```bash
# Identify your Key Vault name (from Step 3 output)
KV_NAME="kv-iconnectelco-dev-xxxxx"

# Rotate the placeholder secrets with your real values
az keyvault secret set \
  --vault-name "$KV_NAME" \
  --name PegaClientId \
  --value "<real-pega-client-id>"

az keyvault secret set \
  --vault-name "$KV_NAME" \
  --name PegaClientSecret \
  --value "<real-pega-client-secret>"

az keyvault secret set \
  --vault-name "$KV_NAME" \
  --name PegaBaseUrl \
  --value "https://<real-tenant>.pegacloud.net"
```

After setting, restart the Function App so it reads the new values:

```bash
# Static Web Apps managed Functions auto-reload on app setting changes,
# but if you want to force it:
az staticwebapp restart --name swa-iconnectelco-dev --resource-group rg-iconnectelco-dev
```

Verify:

```bash
curl -X POST https://<your-swa-hostname>.azurestaticapps.net/api/pega-case \
  -H "Content-Type: application/json" \
  -d '{"caseType":"CT-ACT-NEW","flowKey":"activation","content":{"email":"test@example.com"}}'
```

You should get back a real Pega case ID (not `"simulated": true`).

## Step 7 — Seed the catalog

```bash
cd ../catalog-seed
./seed-catalog.sh iconnectelcodevcat catalog
```

This uploads the four JSON files to blob storage. Your merchandising team then uploads product images to the same container (see [CATALOG.md](./CATALOG.md)).

## Step 8 — DNS and custom domain (production only)

1. In the Azure portal, open your Front Door profile → Endpoints → `cdn-iconnectelco-prod`
2. Add custom domain: `cdn.iconnectelco.com`
3. Azure provides a CNAME target (e.g. `cdn-iconnectelco-prod-abc.z01.azurefd.net`)
4. Add that as a CNAME in your DNS provider
5. Azure provisions a managed TLS certificate (~15 minutes)

Same process for the Static Web App custom domain (`iconnectelco.com` or `portal.iconnectelco.com`):
1. SWA → Custom domains → Add
2. Choose "Other" and follow the DNS TXT + CNAME instructions
3. Wait for validation

## Rolling back

If a deployment breaks production:

```bash
# Revert the offending commit on main
git revert <bad-commit>
git push origin main
```

Static Web Apps will redeploy the previous state automatically. Stored secrets in Key Vault are unaffected.

## Cost estimate

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

Production will scale with traffic. Budget $150-400/month for a live carrier site with modest traffic.

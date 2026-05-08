# iConnecTelco

Customer self-service portal + CSR agent desktop for iConnecTelco, integrated with Pega Platform via Azure Static Web Apps and Python Azure Functions.

## What's in this repository

```
iconnectelco-project/
├── frontend/                    Browser code (HTML/CSS/JS, single-file-per-app)
│   ├── index.html               Landing page (choose Portal or CSR)
│   ├── portal/index.html        Customer self-service portal
│   └── csr/index.html           CSR agent desktop
│
├── api/                         Node.js 20 Azure Functions (the Pega broker)
│   ├── src/index.js             HTTP entrypoints: /api/pega-case, /pega-order, /catalog, /auth-roles, /health
│   ├── src/shared/pega-client.js OAuth 2.0 token broker + case API wrapper
│   ├── src/shared/pega-mock.js  Simulated responses for PEGA_MODE=simulated
│   ├── package.json             npm dependencies (just @azure/functions)
│   ├── host.json                Functions runtime config
│   └── local.settings.json.example   Template for local dev (copy to .gitignored local.settings.json)
│
├── catalog-seed/                Seed data + bulk-upload script for catalog
│   ├── devices.json             8 flagship phones
│   ├── accessories.json         6 real watches and earbuds
│   ├── bundles.json             3 ConnecTelco bundles
│   ├── plans.json               Mobile, internet, prepaid plans
│   └── seed-catalog.sh          Uploads metadata to blob storage
│
├── infrastructure/              Bicep IaC — resource group, SWA, storage, CDN, Key Vault
│   ├── main.bicep               Top-level; orchestrates modules
│   ├── modules/                 Per-resource templates
│   └── parameters/              Environment-specific parameter files
│
├── .github/workflows/deploy.yml GitHub Actions CI/CD (deploys on push to main)
├── staticwebapp.config.json     Routes, auth gates, 404 behavior, security headers
└── *.md                         Documentation (you are here)
```

## Quick start

**Want to just see it run?** The frontend works without any backend — open `frontend/index.html` in a browser and the portal runs in simulated mode (same behavior as the prototype demo).

**Want to deploy to Azure for the first time?** See [AZURE-SETUP.md](./AZURE-SETUP.md) for the full 60-minute walkthrough with every command.

**Want the operational reference (rolling back, rotating creds, costs)?** See [DEPLOYMENT.md](./DEPLOYMENT.md).

**Want to flip on real Pega integration?** See [PEGA-INTEGRATION.md](./PEGA-INTEGRATION.md).

**Want to update the product catalog?** See [CATALOG.md](./CATALOG.md).

## Architecture

```
             ┌──────────────────────────────┐
             │  Azure Static Web Apps       │
             │  ────────────────────────    │
             │   frontend/ (HTML/CSS/JS)    │
             │        ↓                     │
             │   api/ (Python Functions)    │
             │        ↓                     │
             │   reads Key Vault secrets    │
             └────────┬─────────────────────┘
                      │
                      ↓ HTTPS + OAuth 2.0
             ┌──────────────────────────────┐
             │  Pega Platform               │
             │  /prweb/api/application/v2   │
             └──────────────────────────────┘

             ┌──────────────────────────────┐
             │  Azure Front Door CDN        │
             │  cdn.iconnectelco.com        │
             │        ↓                     │
             │  Azure Blob Storage          │
             │  (catalog imagery + JSON)    │
             └──────────────────────────────┘
```

## Environment modes

The backend has two operating modes controlled by a single environment variable:

| `PEGA_MODE` value | Behavior |
|---|---|
| `live` (default) | Real OAuth handshake with Pega, real case creation |
| `simulated` | Fake responses; 600–1500 ms latency, 8% simulated failure rate for demo purposes |

Flip this in the Function App's application settings at any time — no code change, no redeploy.

## Security

- All secrets (Pega `client_id`, `client_secret`, AAD app credentials) live in **Azure Key Vault**. The Function App pulls them at runtime via Key Vault references.
- Credit card numbers and CVVs never reach the backend. Only card brand + last 4 digits are persisted.
- Passwords are never logged. Account creation routes through Entra External ID (not implemented in this scaffold).
- HTTPS enforced everywhere via HSTS headers.
- CORS is restricted to the SWA origin by default.

## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Backend:** Node.js 20 LTS on Azure Functions v4 runtime (v4 programming model with `app.http()` decorators)
- **Infrastructure:** Bicep (Azure Resource Manager templates)
- **CI/CD:** GitHub Actions
- **Pega client:** Native `fetch` (Node 20) with OAuth 2.0 client_credentials grant
- **Storage:** Azure Blob Storage (catalog), Azure Key Vault (secrets)
- **CDN:** Azure Front Door Standard

## Local development

```bash
# Install Azure Functions Core Tools v4 (one-time)
npm install -g azure-functions-core-tools@4 --unbroken

# Install API dependencies
cd api && npm install

# Copy local settings template
cp local.settings.json.example local.settings.json
# Edit local.settings.json — set PEGA_MODE=simulated for local dev without Pega

# Start the Functions runtime
npm start
# API now serves http://localhost:7071/api/*

# In another terminal, serve the frontend
cd ../frontend
python3 -m http.server 8080   # or any static server
# Open http://localhost:8080
```

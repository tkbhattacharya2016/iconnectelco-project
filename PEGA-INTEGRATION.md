# Pega integration guide

How iConnecTelco talks to Pega, how to configure it, and how to troubleshoot when it breaks.

## Flow summary

```
Browser                  Azure Function              Pega Platform
─────────                ──────────────              ─────────────
POST /api/pega-order  →  POST /cases               →  case created
                         Authorization: Bearer <token>
                         Content-Type: application/json
                         {caseTypeID, processID, content}
                         ←─ 201 Created               ←─
                            {ID, etag, stages}
         ←── 200 OK                  
             {orderId, pegaCaseID, 
              status, eta}
```

Before that happens for the first time, the Function fetches an OAuth token:

```
Azure Function                              Pega Platform
──────────────                              ─────────────
POST /prweb/PRRestService/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded
grant_type=client_credentials
&client_id=<from-keyvault>
&client_secret=<from-keyvault>
                                 ←─ 200 OK
                                    {access_token, expires_in: 3600, token_type: "bearer"}
```

The Function caches the token in memory for ~55 minutes (configurable via `PEGA_TOKEN_CACHE_TTL_SECONDS`).

## What you need from Pega before deployment

Ask your Pega administrator to create an **OAuth 2.0 client registration** in your Pega tenant with:

- **Grant type:** `client_credentials`
- **Scope:** whatever your case types require (usually `case:read`, `case:write`, `case:execute`)
- **Allowed operators:** the service account that has permission to create cases in the `CT-*` case types

Capture:

- Base URL (e.g. `https://acme-dev.pegacloud.net`)
- `client_id`
- `client_secret`

Store all three in Azure Key Vault as shown in [DEPLOYMENT.md Step 6](./DEPLOYMENT.md).

## Case types expected by this app

The Python function sends these case type IDs to Pega. Your Pega team needs to have corresponding case types configured:

| Case type ID | When fired | Triggered by |
|---|---|---|
| `CT-ACT-NEW` | New line activation | Self-service "New activation" flow |
| `CT-UPG-NEW` | Device upgrade | Self-service "Device upgrade" flow |
| `CT-SIM-SWAP` | SIM card swap / eSIM transfer | Self-service "SIM swap" flow |
| `CT-PLAN-CHG` | Plan upgrade/downgrade | Self-service "Plan change" flow |
| `CT-PORT-IN` | Number port-in | Self-service "Port-in" flow |
| `CT-BUNDLE` | Bundle activation | Self-service "Bundle & save" flow |
| `CT-ORDER` | Cart checkout | Checkout "Place order" click |

If the Pega team hasn't set up these case types yet, the Function will get a 404 from Pega when it tries to create one. The error surfaces in the UI as "Order failed — please try again" with a recoverable flag so the user can retry.

## Payload shapes

### Browser → /api/pega-order

```json
{
  "customer": { "firstName": "...", "lastName": "...", "email": "...", "phone": "..." },
  "shipping": { "street": "...", "city": "...", "state": "TX", "zip": "..." },
  "billing":  { ... same shape as shipping },
  "payment":  { "method": "card", "brand": "Visa", "last4": "4242", "expiry": "12/28" },
  "items": [
    { "id": "iphone-17-pro", "type": "device", "brand": "Apple", "name": "iPhone 17 Pro", "price": 1099 }
  ],
  "totals": { "subtotal": 1099, "tax": 90.67, "shipping": 0, "total": 1189.67, "dueToday": 1189.67 },
  "channel": "web-portal",
  "submittedAt": "2026-04-24T..."
}
```

### Azure Function → Pega /cases

```json
{
  "caseTypeID": "CT-ORDER",
  "processID": "pyStartCase",
  "content": {
    "OrderChannel": "web-portal",
    "Customer": { "FirstName": "...", "Email": "...", ... },
    "ShippingAddress": { "Line1": "...", "City": "...", ... },
    "Payment": { "Method": "Card", "Brand": "Visa", "Last4": "4242", ... },
    "LineItems": [{ "SKU": "...", "Type": "Device", "Name": "...", "UnitPrice": 1099 }],
    "Totals": { "Subtotal": 1099, "Tax": 90.67, "GrandTotal": 1189.67, "Currency": "USD" }
  }
}
```

The translation from camelCase (browser convention) to PascalCase (Pega convention) happens in `api/function_app.py` in the `_build_order_envelope()` function.

See `sample-pega-payload.json` in the demo bundle for complete payload examples with both card and financing payments.

## Toggling simulation mode

In Function App settings, set `PEGA_MODE=simulated` to stop real Pega calls without changing code. Useful for:

- Demos that don't need Pega to be reachable
- Local development without Pega credentials
- Load testing (avoid hammering Pega with synthetic traffic)
- Outage drills (practice "what if Pega is down" without real downtime)

To flip:

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

## Troubleshooting

### "Environment variable PEGA_CLIENT_ID is not configured"

The Key Vault reference isn't resolving. Check:

1. The secret actually exists: `az keyvault secret show --vault-name <kv> --name PegaClientId`
2. The Function App's managed identity has `Key Vault Secrets User` role on the vault
3. The secret value doesn't start with `PUT_REAL_` (that's the placeholder; rotate it)

### "Pega OAuth token request returned 401"

Your `client_id` or `client_secret` is wrong, or the OAuth client in Pega is disabled. Regenerate the secret in Pega and update Key Vault.

### "Pega case creation failed: 404"

The `caseTypeID` doesn't exist in your Pega tenant. Work with your Pega admin to create the missing case type.

### "Pega case API unreachable"

Network issue between Azure and your Pega tenant. Common causes:

- Your Pega tenant has IP allow-listing. Add the Azure Function's outbound IPs (or use a Private Endpoint).
- DNS doesn't resolve `<tenant>.pegacloud.net` from Azure. Check the `PEGA_BASE_URL` value.

### 8% of orders fail in testing

That's the simulator. Set `PEGA_MODE=live` or accept the failures as intentional (they exist to exercise the autonomous-recovery UX).

## Rate limits and retries

The Python client retries OAuth token refresh **once** on 401 (assumes expired token), then gives up. For rate-limit 429s from Pega, the response includes `Retry-After`; the client doesn't currently honor it — it raises a `PegaError(recoverable=True)` and the UI shows "try again." If you expect high sustained traffic, add exponential backoff in `pega_client.py::_post_case`.

## Security properties

- `client_secret` is **never** logged, echoed in errors, or returned to the browser
- The bearer token is **never** logged
- The token cache is per-process; when a Function instance recycles, a new token is fetched
- Credit card numbers are **never** transmitted to Pega. Only brand + last4 + expiry.

If any of the above stops being true in a future change, that's a security bug — please open a PR to fix it.

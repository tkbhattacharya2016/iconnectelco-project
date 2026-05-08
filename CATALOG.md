# Catalog management

How your merchandising team adds, removes, or updates products shown on the portal.

## What lives where

- **Product metadata** (IDs, names, prices, features, specs) lives as JSON files in Azure Blob Storage: `iconnectelcocatalog/catalog/metadata/*.json`
- **Product imagery** (phone shots, accessory photos) lives in the same blob container under `devices/{sku}/*.webp` and `accessories/{sku}/*.webp`
- **CDN** serves everything via `cdn.iconnectelco.com` (Azure Front Door in front of the blob storage)

## Daily workflow: update a price

You want to change the iPhone 17 Pro from $1099 to $1049:

1. Open `catalog-seed/devices.json` in this repo
2. Find `"id": "iphone-17-pro"` and change `"price": 1099` → `"price": 1049`
3. Commit and push to `main`
4. The GitHub Actions workflow re-uploads the JSON to blob storage
5. Front Door cache invalidates automatically within ~5 minutes
6. The portal fetches the updated catalog on next page load

**No code deploy needed** for metadata-only changes. The `/api/catalog` endpoint reads the JSON directly from blob storage.

## Adding a new device

You're launching the Galaxy S27 Ultra:

1. Add a new entry to `catalog-seed/devices.json`:

   ```json
   {
     "id": "galaxy-s27-ultra",
     "brand": "Samsung",
     "name": "Galaxy S27 Ultra",
     "price": 1399,
     "storage": 256,
     "features": ["Snapdragon 8 Elite Gen 6", "..."],
     "colors": ["Titanium Black", "..."],
     "image": "https://cdn.iconnectelco.com/devices/galaxy-s27-ultra/main.webp"
   }
   ```

2. Ask your marketing team for a transparent-background WebP image (800×800 or higher, < 200 KB)

3. Upload the image:

   ```bash
   az storage blob upload \
     --account-name iconnectelcocatalog \
     --container-name catalog \
     --name devices/galaxy-s27-ultra/main.webp \
     --file ~/Downloads/galaxy-s27-ultra.webp \
     --auth-mode login \
     --content-type image/webp \
     --content-cache "public, max-age=604800"
   ```

4. Commit + push → GitHub Actions redeploys → customers see it.

## Removing a device

Delete the entry from `devices.json` and push. The image files stay in blob storage (no harm in leaving them — they just aren't referenced anymore). Or delete them explicitly:

```bash
az storage blob delete-batch \
  --account-name iconnectelcocatalog \
  --source catalog \
  --pattern "devices/galaxy-s27-ultra/*" \
  --auth-mode login
```

## Image requirements

- **Format:** WebP preferred, PNG acceptable, JPEG discouraged (no transparency)
- **Dimensions:** 800×800 pixels minimum, 1200×1200 recommended
- **Background:** transparent or uniform (the card CSS adds a subtle gradient)
- **File size:** under 200 KB per image (large files hurt LCP / page speed)
- **Naming:** `devices/{sku-id}/main.webp` for the primary shot, optional alternates named `back.webp`, `color-{color-id}.webp`

## Licensing — IMPORTANT

The catalog JSON that ships with this repo points at `cdn.iconnectelco.com` URLs that **don't exist yet**. Before launch, your team must:

1. Obtain licensed imagery from each manufacturer's partner/co-marketing program (Apple MFi partner portal, Samsung Partner Hub, Google Partner Dashboard)
2. Upload those licensed assets to the CDN
3. Verify URLs resolve and render

Using unlicensed imagery pulled from competitor sites or Wikipedia in production creates legal risk. The demo uses public URLs with SVG fallbacks — that's fine for a prototype but not for a production carrier site.

## Catalog fallback

If `/api/catalog` fails (storage outage, CDN misconfiguration, permission mishap), the portal falls back to embedded catalog data baked into the page. This means:

- The portal always renders *something*
- The embedded data is whatever shipped in the last code deploy
- Customers might see stale prices during an incident (better than a blank page)

To update the fallback data, change the `const devices = [...]`, `const accessories = [...]`, etc. arrays at the top of `<script>` blocks in `frontend/portal/index.html` and redeploy. In most cases you don't need to do this — the blob storage update is enough.

## Operational commands

**List everything in the catalog container:**

```bash
az storage blob list \
  --account-name iconnectelcocatalog \
  --container-name catalog \
  --auth-mode login \
  --output table
```

**Purge CDN cache for a specific image (rare; normally TTL handles it):**

```bash
az afd endpoint purge \
  --resource-group rg-iconnectelco-prod \
  --profile-name fd-iconnectelco-prod \
  --endpoint-name cdn-iconnectelco-prod \
  --content-paths "/devices/iphone-17-pro/main.webp"
```

**Re-run the seed script to rebuild the metadata:**

```bash
./catalog-seed/seed-catalog.sh iconnectelcocatalog catalog
```

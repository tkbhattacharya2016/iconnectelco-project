// ============================================================================
// iConnecTelco infrastructure — main template
//
// Provisions:
//   - Azure Static Web App (hosts frontend + managed Functions API)
//   - Storage Account + Blob container (catalog imagery + metadata)
//   - Azure Front Door (CDN for catalog imagery)
//   - Azure Key Vault (Pega credentials + AAD client secret)
//   - Application Insights (observability)
//
// Usage:
//   az deployment sub create \
//     --location eastus \
//     --template-file main.bicep \
//     --parameters parameters/dev.parameters.json
// ============================================================================

targetScope = 'subscription'

@description('Deployment environment name: dev, staging, or prod')
@allowed(['dev', 'staging', 'prod'])
param environmentName string

@description('Azure region for the resource group and all resources')
param location string = 'eastus'

@description('Base name for all resources (lowercase, no hyphens, max 18 chars)')
@maxLength(18)
param baseName string = 'iconnectelco'

@description('Microsoft Entra ID tenant ID for authentication')
param tenantId string

@description('Object ID of the team member who will manage Key Vault secrets')
param keyVaultAdminObjectId string

@description('Pega tenant base URL (e.g. https://your-tenant.pegacloud.net). Set as Key Vault secret separately.')
param pegaBaseUrl string

// Resource group for the environment
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${baseName}-${environmentName}'
  location: location
  tags: {
    Environment: environmentName
    Project: 'iConnecTelco'
    ManagedBy: 'Bicep'
  }
}

// Storage (catalog imagery + metadata)
module storage 'modules/storage-account.bicep' = {
  scope: rg
  name: 'storage-${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
  }
}

// Key Vault (Pega credentials + AAD client secret)
module keyVault 'modules/key-vault.bicep' = {
  scope: rg
  name: 'kv-${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
    tenantId: tenantId
    adminObjectId: keyVaultAdminObjectId
    pegaBaseUrl: pegaBaseUrl
  }
}

// Static Web App (frontend + API)
module swa 'modules/static-web-app.bicep' = {
  scope: rg
  name: 'swa-${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
    keyVaultName: keyVault.outputs.keyVaultName
    catalogStorageAccount: storage.outputs.storageAccountName
    pegaBaseUrl: pegaBaseUrl
  }
}

// CDN / Front Door in front of storage
module cdn 'modules/cdn.bicep' = {
  scope: rg
  name: 'cdn-${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    storageAccountName: storage.outputs.storageAccountName
    storageBlobEndpoint: storage.outputs.blobEndpoint
  }
}

// Outputs
output resourceGroup string = rg.name
output staticWebAppDefaultHostname string = swa.outputs.defaultHostname
output staticWebAppName string = swa.outputs.staticWebAppName
output keyVaultName string = keyVault.outputs.keyVaultName
output storageAccountName string = storage.outputs.storageAccountName
output cdnEndpoint string = cdn.outputs.cdnEndpoint

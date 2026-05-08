// Static Web App with managed Python Functions.
// Pulls Pega credentials from Key Vault via secret references.

param baseName string
param environmentName string
param location string
param keyVaultName string
param catalogStorageAccount string
param pegaBaseUrl string

// Static Web Apps is only GA in a small set of regions; the public ones
// include East US 2, Central US, West US 2, West Europe, East Asia.
// We default the SWA to East US 2 for this reason.
var swaLocation = 'eastus2'
var staticWebAppName = 'swa-${baseName}-${environmentName}'

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: swaLocation
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
    provider: 'GitHub'
    // Actual GitHub source wiring happens via `az staticwebapp` CLI after deployment
    // so secrets don't need to flow through Bicep parameters.
  }
  tags: {
    Environment: environmentName
    Project: 'iConnecTelco'
  }
}

// Application Insights for observability
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${baseName}-${environmentName}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${baseName}-${environmentName}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

// App settings for the managed Functions runtime. Key Vault references use
// the `@Microsoft.KeyVault(SecretUri=...)` syntax so the Function pulls the
// real secret at startup time. Never shipped in code, never in Git.
resource swaAppSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    PEGA_MODE: 'live'
    PEGA_BASE_URL: pegaBaseUrl
    PEGA_CLIENT_ID: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=PegaClientId)'
    PEGA_CLIENT_SECRET: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=PegaClientSecret)'
    PEGA_TOKEN_CACHE_TTL_SECONDS: '3300'
    CATALOG_STORAGE_ACCOUNT: catalogStorageAccount
    CATALOG_CONTAINER_NAME: 'catalog'
    CATALOG_CDN_BASE_URL: 'https://cdn.${baseName}.com'
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
    FUNCTIONS_WORKER_RUNTIME: 'node'
    FUNCTIONS_EXTENSION_VERSION: '~4'
    AzureWebJobsFeatureFlags: 'EnableWorkerIndexing'
    WEBSITE_NODE_DEFAULT_VERSION: '~20'
  }
}

// Grant the Static Web App's system-assigned identity permission to read KV
// NOTE: SWAs don't have native MI yet in some regions. If this deploy fails,
// the manual fallback is to create a User-Assigned Managed Identity and
// grant it the Key Vault Secrets User role.

output staticWebAppName string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
output staticWebAppId string = staticWebApp.id
output appInsightsConnectionString string = appInsights.properties.ConnectionString

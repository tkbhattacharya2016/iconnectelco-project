// Storage account for catalog imagery and metadata

@description('Base name for the storage account')
param baseName string

@description('Environment name (dev/staging/prod)')
param environmentName string

@description('Azure region')
param location string

// Storage account name must be 3-24 chars, lowercase alphanumeric only
var storageAccountName = toLower('${baseName}${environmentName}cat')

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_ZRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowSharedKeyAccess: true
    encryption: {
      services: {
        blob: {
          enabled: true
          keyType: 'Account'
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: ['*']
          allowedMethods: ['GET', 'HEAD', 'OPTIONS']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

// Public-read container for catalog assets
resource catalogContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobServices
  name: 'catalog'
  properties: {
    publicAccess: 'Blob'
  }
}

output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
output containerName string = catalogContainer.name

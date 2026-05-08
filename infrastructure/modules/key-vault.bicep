// Azure Key Vault — stores Pega credentials + AAD client secret.
// The Static Web App's managed Functions pull these via Key Vault references
// in their app settings. Never logged, never shipped in code.

param baseName string
param environmentName string
param location string
param tenantId string

@description('Object ID of the team member managing secrets (you)')
param adminObjectId string

@description('Pega base URL (non-secret but grouped for convenience)')
param pegaBaseUrl string

var keyVaultName = take('kv-${baseName}-${environmentName}-${uniqueString(resourceGroup().id)}', 24)

resource keyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

// Grant admin access so the team member can set/rotate secrets
resource adminRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  // Key Vault Secrets Officer role
  name: guid(keyVault.id, adminObjectId, 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
    principalId: adminObjectId
    principalType: 'User'
  }
}

// Placeholder secrets — real values must be set via `az keyvault secret set` post-deploy
resource pegaBaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: keyVault
  name: 'PegaBaseUrl'
  properties: {
    value: pegaBaseUrl
  }
}

// These two are placeholders. Rotate them with real values before flipping PEGA_MODE=live.
resource pegaClientIdSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: keyVault
  name: 'PegaClientId'
  properties: {
    value: 'PUT_REAL_CLIENT_ID_HERE'
  }
}

resource pegaClientSecretSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: keyVault
  name: 'PegaClientSecret'
  properties: {
    value: 'PUT_REAL_CLIENT_SECRET_HERE'
  }
}

output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output keyVaultId string = keyVault.id

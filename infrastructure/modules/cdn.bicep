// Azure Front Door (Standard) in front of the storage blob endpoint.
// Serves product imagery under cdn.<yourdomain>.com after DNS CNAME is configured.

param baseName string
param environmentName string
param storageAccountName string
param storageBlobEndpoint string

var profileName = 'fd-${baseName}-${environmentName}'
var endpointName = 'cdn-${baseName}-${environmentName}'
var originGroupName = 'catalog-origin-group'
var originName = 'storage-blob-origin'
var routeName = 'catalog-route'

// Front Door is global, not regional
resource frontDoorProfile 'Microsoft.Cdn/profiles@2024-02-01' = {
  name: profileName
  location: 'Global'
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
}

resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = {
  parent: frontDoorProfile
  name: endpointName
  location: 'Global'
  properties: {
    enabledState: 'Enabled'
  }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: frontDoorProfile
  name: originGroupName
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/catalog/metadata/devices.json'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 100
    }
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: originGroup
  name: originName
  properties: {
    hostName: replace(replace(storageBlobEndpoint, 'https://', ''), '/', '')
    httpPort: 80
    httpsPort: 443
    originHostHeader: replace(replace(storageBlobEndpoint, 'https://', ''), '/', '')
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: frontDoorEndpoint
  name: routeName
  properties: {
    originGroup: {
      id: originGroup.id
    }
    supportedProtocols: ['Http', 'Https']
    patternsToMatch: ['/*']
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
    cacheConfiguration: {
      queryStringCachingBehavior: 'IgnoreQueryString'
      compressionSettings: {
        contentTypesToCompress: [
          'application/json'
          'image/svg+xml'
          'text/css'
          'text/html'
          'text/javascript'
        ]
        isCompressionEnabled: true
      }
    }
  }
  dependsOn: [
    origin
  ]
}

output cdnEndpoint string = frontDoorEndpoint.properties.hostName
output cdnProfileName string = frontDoorProfile.name

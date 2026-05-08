/**
 * Pega API client — OAuth 2.0 client_credentials token broker with caching,
 * plus thin wrappers over Pega case creation and advancement endpoints.
 *
 * Credentials are read from process.env, which in production is populated
 * by Azure Key Vault references on the Function App's application settings.
 *
 * Security:
 *   - Never logs PEGA_CLIENT_SECRET or bearer tokens
 *   - Never echoes credentials in error messages
 *   - Token cache TTL is ~5 min below actual expiry to avoid edge-of-expiry failures
 */

let cachedToken = null;
let cachedTokenExpiresAt = 0;

// Mutex for token refresh — prevents thundering-herd when many concurrent
// requests arrive after cache expiry. JS is single-threaded but async, so
// we serialize the in-flight refresh with a Promise.
let tokenRefreshInFlight = null;

export class PegaError extends Error {
  constructor(message, statusCode = 500, recoverable = false) {
    super(message);
    this.name = 'PegaError';
    this.statusCode = statusCode;
    this.recoverable = recoverable;
  }
}

function requireEnv(key) {
  const v = process.env[key] || '';
  if (!v || v.startsWith('PUT_REAL_')) {
    throw new PegaError(
      `Environment variable ${key} is not configured. See DEPLOYMENT.md.`,
      500,
      false
    );
  }
  return v;
}

/**
 * Return a cached or freshly fetched OAuth access token from Pega.
 */
export async function getPegaToken() {
  const now = Date.now();
  // 30s safety margin
  if (cachedToken && cachedTokenExpiresAt > now + 30_000) {
    return cachedToken;
  }
  // If a refresh is already in flight, wait for it instead of starting a parallel one
  if (tokenRefreshInFlight) {
    return await tokenRefreshInFlight;
  }
  tokenRefreshInFlight = (async () => {
    try {
      const baseUrl = requireEnv('PEGA_BASE_URL').replace(/\/$/, '');
      const clientId = requireEnv('PEGA_CLIENT_ID');
      const clientSecret = requireEnv('PEGA_CLIENT_SECRET');
      const ttlSeconds = parseInt(process.env.PEGA_TOKEN_CACHE_TTL_SECONDS || '3300', 10);

      const tokenUrl = `${baseUrl}/prweb/PRRestService/oauth2/v1/token`;
      const body = new URLSearchParams();
      body.set('grant_type', 'client_credentials');
      body.set('client_id', clientId);
      body.set('client_secret', clientSecret);

      let resp;
      try {
        resp = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: AbortSignal.timeout(10_000)
        });
      } catch (err) {
        // Never include credentials in the error
        throw new PegaError(
          `Pega OAuth token request failed to reach Pega: ${err.name}`,
          502,
          true
        );
      }

      if (!resp.ok) {
        throw new PegaError(
          `Pega OAuth token request returned ${resp.status}`,
          resp.status,
          resp.status >= 500
        );
      }

      const json = await resp.json();
      if (!json.access_token) {
        throw new PegaError('Pega OAuth response did not include access_token', 502, true);
      }

      cachedToken = json.access_token;
      cachedTokenExpiresAt = Date.now() + ttlSeconds * 1000;
      return cachedToken;
    } finally {
      tokenRefreshInFlight = null;
    }
  })();
  return await tokenRefreshInFlight;
}

/**
 * Force a token refresh on next call (use after a 401).
 */
export function invalidateToken() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
}

/**
 * Create a new case in Pega.
 * @param {string} caseTypeID - e.g. 'CT-ORDER', 'CT-PORT-IN', 'CT-ACT-NEW'
 * @param {object} content - case-property payload (PascalCase per Pega convention)
 * @returns {Promise<{caseID: string, status: string, etag?: string, stages: any[]}>}
 */
export async function createCase(caseTypeID, content) {
  const baseUrl = requireEnv('PEGA_BASE_URL').replace(/\/$/, '');
  const url = `${baseUrl}/prweb/api/application/v2/cases`;
  const body = { caseTypeID, processID: 'pyStartCase', content };

  // First attempt
  let token = await getPegaToken();
  let resp = await postCase(url, token, body);

  // One retry on 401 in case the token expired between cache check and use
  if (resp.status === 401) {
    invalidateToken();
    token = await getPegaToken();
    resp = await postCase(url, token, body);
  }

  if (!resp.ok) {
    throw new PegaError(
      `Pega case creation failed: ${resp.status}`,
      resp.status,
      resp.status >= 500 || resp.status === 429
    );
  }

  const data = await resp.json();
  return {
    caseID: data.ID || '',
    status: data.status || 'Processing',
    etag: data.etag || null,
    stages: data.stages || []
  };
}

async function postCase(url, token, body) {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (err) {
    throw new PegaError(`Pega case API unreachable: ${err.name}`, 502, true);
  }
}

/**
 * Advance an existing case to its next assignment (used by CSR actions).
 */
export async function advanceCase(caseID, assignmentID, content) {
  const baseUrl = requireEnv('PEGA_BASE_URL').replace(/\/$/, '');
  const encodedCase = encodeURIComponent(caseID);
  const url = `${baseUrl}/prweb/api/application/v2/cases/${encodedCase}/assignments/${assignmentID}`;

  const token = await getPegaToken();
  let resp;
  try {
    resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (err) {
    throw new PegaError(`Pega advance API unreachable: ${err.name}`, 502, true);
  }

  if (!resp.ok) {
    throw new PegaError(
      `Pega case advancement failed: ${resp.status}`,
      resp.status,
      resp.status >= 500
    );
  }
  return await resp.json();
}

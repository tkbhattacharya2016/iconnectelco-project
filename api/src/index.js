/**
 * iConnecTelco Azure Functions app — Node.js 20, v4 programming model.
 *
 * Endpoints:
 *   POST /api/pega-case     Create a self-service case (activation, port-in, etc.)
 *   POST /api/pega-order    Create an order case (cart checkout)
 *   GET  /api/catalog       Return devices/accessories/bundles/plans
 *   POST /api/auth-roles    SWA role assignment callback
 *   GET  /api/health        Liveness probe
 *
 * Mode switch:
 *   PEGA_MODE=live        (default)  — real OAuth + Pega REST calls
 *   PEGA_MODE=simulated              — fake responses for local dev / demo
 */

import { app } from '@azure/functions';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCase, PegaError } from './shared/pega-client.js';
import { simulateCreateCase, simulateCreateOrder } from './shared/pega-mock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function isSimulated() {
  return (process.env.PEGA_MODE || 'live').toLowerCase() === 'simulated';
}

function jsonResponse(body, status = 200) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function errorResponse(message, status, recoverable = false) {
  return jsonResponse({ error: message, recoverable }, status);
}

// ============================================================
// /api/pega-case — Self-service flows
// ============================================================
app.http('pega-case', {
  methods: ['POST'],
  route: 'pega-case',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const caseType = payload.caseType || 'CT-ACT-NEW';
    const flowKey = payload.flowKey || 'unknown';
    const content = payload.content || {};

    const pegaContent = {
      FlowKey: flowKey,
      SubmittedAt: new Date().toISOString(),
      Source: { Channel: payload.channel || 'web-portal' },
      Customer: toPegaCustomer(content),
      ServiceDetails: toPegaServiceDetails(flowKey, content)
    };

    try {
      const result = isSimulated()
        ? await simulateCreateCase(caseType, pegaContent)
        : await createCase(caseType, pegaContent);

      return jsonResponse({
        caseID: result.caseID,
        status: result.status,
        eta: result.eta || 'Live in 8-12 minutes'
      });
    } catch (err) {
      if (err instanceof PegaError) {
        context.warn(`Pega case creation failed type=${caseType} recoverable=${err.recoverable}: ${err.message}`);
        return errorResponse(err.message, err.statusCode, err.recoverable);
      }
      context.error('Unexpected error creating case', err);
      return errorResponse(`Internal error: ${err.name || 'Unknown'}`, 500, false);
    }
  }
});

function toPegaCustomer(content) {
  const map = {
    name: 'FullName',
    firstName: 'FirstName',
    lastName: 'LastName',
    email: 'Email',
    phone: 'MobilePhone',
    msisdn: 'MobilePhone',
    dob: 'DateOfBirth'
  };
  const out = {};
  for (const [browserKey, pegaKey] of Object.entries(map)) {
    if (content[browserKey]) out[pegaKey] = content[browserKey];
  }
  return out;
}

function toPegaServiceDetails(flowKey, content) {
  const skip = new Set(['name', 'firstName', 'lastName', 'email', 'phone', 'msisdn', 'dob']);
  const out = {};
  for (const [k, v] of Object.entries(content)) {
    if (skip.has(k)) continue;
    const pegaKey = k[0].toUpperCase() + k.slice(1);
    out[pegaKey] = v;
  }
  out.FlowKey = flowKey;
  return out;
}

// ============================================================
// /api/pega-order — Cart checkout
// ============================================================
app.http('pega-order', {
  methods: ['POST'],
  route: 'pega-order',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    try {
      let result;
      if (isSimulated()) {
        result = await simulateCreateOrder(payload);
      } else {
        const pegaContent = buildOrderEnvelope(payload);
        const pegaResult = await createCase('CT-ORDER', pegaContent);
        result = {
          orderId: 'ORD-' + (pegaResult.caseID || '').replace(/\s/g, '-').replace(/^CT-ORDER-/, ''),
          pegaCaseID: pegaResult.caseID,
          status: pegaResult.status,
          estimatedDelivery: 'Next business day'
        };
      }
      return jsonResponse(result);
    } catch (err) {
      if (err instanceof PegaError) {
        context.warn(`Pega order creation failed recoverable=${err.recoverable}: ${err.message}`);
        return errorResponse(err.message, err.statusCode, err.recoverable);
      }
      context.error('Unexpected error creating order', err);
      return errorResponse(`Internal error: ${err.name || 'Unknown'}`, 500, false);
    }
  }
});

function buildOrderEnvelope(payload) {
  const customer = payload.customer || {};
  const shipping = payload.shipping || {};
  const billing = payload.billing || shipping;
  const payment = payload.payment || {};
  const items = payload.items || [];
  const totals = payload.totals || {};

  return {
    OrderChannel: payload.channel || 'web-portal',
    SubmittedAt: payload.submittedAt || new Date().toISOString(),
    Customer: {
      FirstName: customer.firstName || '',
      LastName: customer.lastName || '',
      Email: customer.email || '',
      MobilePhone: customer.phone || '',
      DateOfBirth: customer.dob || null,
      AccountType: customer.accountType === 'new' ? 'New' : 'Existing'
    },
    ShippingAddress: {
      Line1: shipping.street || '',
      City: shipping.city || '',
      State: shipping.state || '',
      PostalCode: shipping.zip || '',
      Country: shipping.country || 'US'
    },
    BillingAddress: {
      Line1: billing.street || '',
      City: billing.city || '',
      State: billing.state || '',
      PostalCode: billing.zip || '',
      Country: billing.country || 'US',
      SameAsShipping: billing === shipping
    },
    Payment: {
      Method: payment.method === 'card' ? 'Card' : 'Financing',
      Brand: payment.brand || '',
      Last4: payment.last4 || '',
      Expiry: payment.expiry || '',
      NameOnCard: payment.nameOnCard || null,
      FinancingMonths: payment.financingMonths || null,
      MonthlyAmount: totals.monthlyFinancing || null
    },
    LineItems: items.map(i => ({
      SKU: i.id || '',
      Type: (i.type || '').charAt(0).toUpperCase() + (i.type || '').slice(1),
      Brand: i.brand || null,
      Name: i.name || '',
      Quantity: 1,
      UnitPrice: i.price || 0,
      Storage: i.storage ? `${i.storage}GB` : null
    })),
    Totals: {
      Subtotal: totals.subtotal || 0,
      Tax: totals.tax || 0,
      Shipping: totals.shipping || 0,
      DeviceTotal: totals.deviceTotal || 0,
      MonthlyFinancing: totals.monthlyFinancing || 0,
      DueToday: totals.dueToday || 0,
      GrandTotal: totals.total || 0,
      Currency: 'USD'
    }
  };
}

// ============================================================
// /api/catalog — Returns devices/accessories/bundles/plans
// ============================================================
app.http('catalog', {
  methods: ['GET'],
  route: 'catalog',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const result = {};
    // Look in two locations: ../catalog-seed (when project is laid out as a monorepo)
    // and ./catalog-seed (when api/ is deployed standalone with its own copy).
    const candidates = [
      join(__dirname, '..', '..', 'catalog-seed'),
      join(__dirname, '..', 'catalog-seed'),
      join(__dirname, 'catalog-seed')
    ];
    let catalogDir = null;
    for (const dir of candidates) {
      try {
        await readFile(join(dir, 'devices.json'), 'utf-8');
        catalogDir = dir;
        break;
      } catch { /* try next */ }
    }

    if (!catalogDir) {
      return jsonResponse({ devices: [], accessories: [], bundles: [], plans: {} });
    }

    for (const name of ['devices', 'accessories', 'bundles', 'plans']) {
      try {
        const text = await readFile(join(catalogDir, `${name}.json`), 'utf-8');
        result[name] = JSON.parse(text);
      } catch (err) {
        context.warn(`Could not load ${name}.json: ${err.message}`);
        result[name] = name === 'plans' ? {} : [];
      }
    }

    result.cdnBaseUrl = process.env.CATALOG_CDN_BASE_URL || '';
    return jsonResponse(result);
  }
});

// ============================================================
// /api/auth-roles — SWA role assignment callback
// ============================================================
app.http('auth-roles', {
  methods: ['POST'],
  route: 'auth-roles',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let payload = {};
    try {
      payload = await request.json();
    } catch {
      // Empty body is acceptable
    }

    const userDetails = (payload.userDetails || '').toLowerCase();
    const claims = payload.claims || [];
    const roles = ['authenticated'];

    // CSR agents: email ends in @iconnectelco.com OR Entra group membership
    if (userDetails.endsWith('@iconnectelco.com')) {
      roles.push('csr');
    } else if (
      claims.some(c => c.typ === 'groups' && c.val === (process.env.CSR_GROUP_ID || ''))
    ) {
      roles.push('csr');
    } else {
      roles.push('customer');
    }

    return jsonResponse({ roles });
  }
});

// ============================================================
// /api/health — Liveness probe
// ============================================================
app.http('health', {
  methods: ['GET'],
  route: 'health',
  authLevel: 'anonymous',
  handler: async () => {
    return jsonResponse({
      status: 'ok',
      mode: isSimulated() ? 'simulated' : 'live',
      timestamp: new Date().toISOString()
    });
  }
});

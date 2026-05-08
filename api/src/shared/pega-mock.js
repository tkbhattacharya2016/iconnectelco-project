/**
 * Simulated Pega responses used when PEGA_MODE=simulated (local dev, demos).
 * Returns realistic-shaped fake data with ~8% random failure rate to exercise
 * the autonomous-recovery path in the UI.
 */

import { PegaError } from './pega-client.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function simulateCreateCase(caseTypeID, content) {
  // Simulate 600-1500ms latency like the browser demo shim
  await sleep(600 + Math.random() * 900);

  // 8% simulated upstream failure to exercise recovery flow
  if (Math.random() < 0.08) {
    throw new PegaError('Simulated Pega upstream unavailable', 502, true);
  }

  return {
    caseID: `CT-${Math.floor(Math.random() * 900_000) + 100_000}`,
    status: 'Resolved-Completed',
    etag: new Date().toISOString().replace(/[-:]/g, '').replace('T', 'T').slice(0, 18) + ' GMT',
    stages: [
      { ID: 'PRIM0', name: 'Validate', visited_status: 'completed' }
    ],
    eta: 'Live in 8-12 minutes',
    simulated: true
  };
}

export async function simulateCreateOrder(payload) {
  await sleep(600 + Math.random() * 900);

  const items = payload.items || [];
  const total = items.reduce((s, i) => s + (i.price || 0), 0);
  const orderId = 'ORD-' + Math.random().toString(36).slice(2, 12).toUpperCase();

  return {
    orderId,
    pegaCaseID: `CT-ORDER C-${Math.floor(Math.random() * 900_000) + 100_000}`,
    total,
    itemCount: items.length,
    status: 'Processing',
    estimatedDelivery: 'Next business day',
    simulated: true
  };
}

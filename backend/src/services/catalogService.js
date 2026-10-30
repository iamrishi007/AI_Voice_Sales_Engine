import { repo } from '../repo/index.js';
import { logged } from './apiLogger.js';

/** Contract shape from the assignment: { SKU: { name, max_capacity_per_unit, plans } } */
export async function readCatalog() {
  const products = await repo.listProducts();
  return Object.fromEntries(products.map((p) => [p.sku, { name: p.name, max_capacity_per_unit: p.maxCapacityPerUnit, plans: p.plans }]));
}

// get_catalog_info(query) — the GET API the agent must call before discussing / booking.
export function getCatalogInfo(query, { conversationId, calls, note } = {}) {
  return logged({ method: 'GET', path: `/api/catalog${query ? `?query=${encodeURIComponent(String(query).slice(0, 80))}` : ''}`, request: null, conversationId, calls, note }, readCatalog);
}

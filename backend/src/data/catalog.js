// Exact catalog from the assignment (GET /api/catalog contract).
export const SEED_CATALOG = {
  SKU_AIRPODS_PRO2: { name: 'AirPods Pro 2nd Gen', max_capacity_per_unit: 1, plans: { STD: 249.0, CARE: 279.0 } },
  SKU_MESH_WIFI6: { name: 'AeroMesh Wi-Fi 6E Home Pack', max_capacity_per_unit: 2, plans: { STD: 399.0, PRO: 499.0 } },
  SKU_TEAM_HUB: { name: 'SyncHub Conference Bar', max_capacity_per_unit: 3, plans: { STD: 899.0, PRO: 1150.0 } },
};

// Server-side metadata used only for matching & wording (not part of the API contract).
export const SKU_META = {
  SKU_AIRPODS_PRO2: {
    coverageUnit: 'person',
    coverageUnitPlural: 'people',
    aliases: ['airpods', 'airpod', 'air pods', 'earbuds', 'earbud', 'earphones', 'apple earbuds'],
  },
  SKU_MESH_WIFI6: {
    coverageUnit: 'room',
    coverageUnitPlural: 'rooms',
    aliases: ['aeromesh', 'aero mesh', 'arrow mesh', 'aero mash', 'mesh', 'wifi', 'wi fi', 'wifi6', 'wifi 6e', 'mesh wifi'],
  },
  SKU_TEAM_HUB: {
    coverageUnit: 'person',
    coverageUnitPlural: 'people',
    aliases: ['synchub', 'sync hub', 'sink hub', 'sinc hub', 'syn hub', 'conference bar', 'conference', 'team hub', 'video bar', 'hub'],
  },
};

import { SKU_META } from '../data/catalog.js';

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/wi[\s-]?fi/g, 'wifi')
    .replace(/[-_/]/g, ' ')
    .replace(/[^a-z0-9%+.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const similarity = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length);

// Things we do NOT sell. If the user names one of these we must never fall back to a catalog item.
const FOREIGN_BRANDS = [
  'netgear', 'orbi', 'eero', 'tp link', 'tplink', 'linksys', 'asus', 'ubiquiti', 'unifi', 'google nest', 'nest wifi',
  'bose', 'sony', 'jabra', 'poly', 'polycom', 'logitech', 'cisco', 'webex', 'samsung', 'galaxy buds', 'jbl', 'beats',
  'sennheiser', 'huawei', 'xiaomi', 'echo', 'alexa', 'owl', 'meeting owl', 'neat bar', 'yealink',
];
const FOREIGN_NOUNS = ['router', 'laptop', 'phone', 'iphone', 'tv', 'television', 'monitor', 'projector', 'speaker', 'soundbar', 'headphones', 'camera', 'watch', 'tablet', 'ipad', 'macbook', 'printer'];
const AIRPODS_OTHER_VARIANTS = /air ?pods? ?(max|3|4|gen ?[134]|1st|3rd|4th|pro ?1|pro 1st|pro ?3)/;

/**
 * @returns {{status:'MATCH', sku:string, confidence:number}
 *          |{status:'NONE', mention:string}       // user asked for something we don't sell
 *          |{status:'AMBIGUOUS', skus:string[]}
 *          |{status:'ABSENT'}}                    // no product mentioned at all
 */
export function matchProduct(texts, catalog) {
  const joined = norm(texts.filter(Boolean).join(' '));
  if (!joined) return { status: 'ABSENT' };

  // 1) hard guards
  if (AIRPODS_OTHER_VARIANTS.test(joined)) return { status: 'NONE', mention: 'a different AirPods model' };
  for (const b of FOREIGN_BRANDS) if (new RegExp(`\\b${b}\\b`).test(joined)) return { status: 'NONE', mention: b };

  // 2) fuzzy alias match, per SKU
  const words = joined.split(' ').filter(Boolean);
  const grams = new Set(words);
  for (let i = 0; i < words.length - 1; i++) {
    grams.add(words[i] + ' ' + words[i + 1]);
    grams.add(words[i] + words[i + 1]);
  }
  const hits = [];
  for (const sku of Object.keys(catalog)) {
    const meta = SKU_META[sku];
    if (!meta) continue;
    let best = 0;
    for (const alias of meta.aliases) {
      for (const g of grams) {
        const a = alias.replace(/ /g, '');
        const gg = g.replace(/ /g, '');
        let s = a === gg ? 1 : 0;
        if (!s && a.length >= 5 && gg.length >= 5) {
          const sim = similarity(a, gg);
          if (sim >= 0.78) s = sim;
        }
        best = Math.max(best, s);
      }
    }
    if (best > 0) hits.push({ sku, best });
  }
  if (hits.length === 1) return { status: 'MATCH', sku: hits[0].sku, confidence: hits[0].best };
  if (hits.length > 1) {
    hits.sort((a, b) => b.best - a.best);
    if (hits[0].best - hits[1].best >= 0.15) return { status: 'MATCH', sku: hits[0].sku, confidence: hits[0].best };
    return { status: 'AMBIGUOUS', skus: hits.map((h) => h.sku) };
  }
  // 3) nothing matched: is it a product we clearly don't carry?
  const noun = FOREIGN_NOUNS.find((n) => words.includes(n));
  if (noun) return { status: 'NONE', mention: noun };
  return { status: 'ABSENT' };
}

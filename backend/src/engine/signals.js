import { norm, matchProduct, levenshtein } from './matcher.js';
import { ALLOWED_CODES } from './pricing.js';

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const wordsToDigits = (t) => t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/g, (w) => String(NUM_WORDS[w]));

const CAPACITY_UNITS = '(?:rooms?|bedrooms?|bhk|people|persons?|members?|seats?|employees?|attendees|participants|users|staff|folks|floors?|workers|colleagues|team ?mates|guys)';
const UNIT_WORDS = '(?:units?|pcs|pieces?|packs?|pairs?|sets?|bars?|hubs?|nodes?|devices?)';
const PRODUCT_WORDS = '(?:aero ?mesh|arrow mesh|mesh|air ?pods?|earbuds|sync ?hub|sink hub|conference bars?|wifi|hubs?)';

export function extractCount(raw) {
  const t = wordsToDigits(norm(raw));
  let m;
  if ((m = t.match(new RegExp(`\\b(\\d{1,4})\\s*(?:x\\s*)?${UNIT_WORDS}\\b`)))) return { value: +m[1], kind: 'units' };
  if ((m = t.match(new RegExp(`\\b(\\d{1,4})\\s*${CAPACITY_UNITS}\\b`)))) return { value: +m[1], kind: 'capacity' };
  if ((m = t.match(/\b(?:for|covering|cover|across|of)\s+(\d{1,4})\b(?!\s*%)/))) return { value: +m[1], kind: 'capacity' };
  if ((m = t.match(new RegExp(`\\b(\\d{1,4})\\s+(?:of\\s+)?(?:the\\s+)?${PRODUCT_WORDS}`)))) return { value: +m[1], kind: 'units' };
  if ((m = t.match(/\b(?:make it|change(?: it)? to|switch to|update(?: it)? to|actually|instead|now|let'?s say|say|going with|go with)\s+(\d{1,4})\b(?!\s*%)/))) return { value: +m[1], kind: 'capacity' };
  if ((m = t.match(/^(\d{1,4})$/))) return { value: +m[1], kind: 'capacity', bare: true };
  return null;
}

export function extractPlan(raw) {
  let t = norm(raw)
    .replace(/air ?pods? ?pro ?(2(nd)?)?( ?gen(eration)?)?/g, 'airpods')
    .replace(/\bpro ?(2nd|2) gen\b/g, ' ');
  const re = /\b(std|standard|basic|pro|professional|care|care\+|applecare)\b/g;
  const toCode = (w) => (['std', 'standard', 'basic'].includes(w) ? 'STD' : ['care', 'care+', 'applecare'].includes(w) ? 'CARE' : 'PRO');
  const directed = t.match(/\b(?:to|switch to|change to|make it|go with|want|prefer|upgrade to|downgrade to|take|choose|on the|on)\s+(?:the\s+)?(std|standard|basic|pro|professional|care|applecare)\b/g);
  if (directed) {
    const last = directed[directed.length - 1].match(/(std|standard|basic|pro|professional|care|applecare)$/)[1];
    return toCode(last);
  }
  let last = null, m;
  while ((m = re.exec(t))) last = m[1];
  return last ? toCode(last) : null;
}

const CONFIRM_RE = /\b(yes|yep|yeah|yup|sure|ok|okay|confirm|confirmed|book it|book this|book now|go ahead|proceed|do it|sounds good|i agree|agreed|let'?s do it|lets do it|place (?:the |my )?order|that works|perfect|fine|deal|absolutely|please book)\b/;
const NEGATION_RE = /\b(no|nope|not|don'?t|dont|never|wait|hold on|hold off|stop|cancel|but|however|instead|actually|change|switch|make it|too|expensive|cheaper)\b/;
const CANCEL_RE = /\b(cancel|never ?mind|forget it|no thanks|not interested|start over|reset|abort)\b/;
const OBJECTION_RE = /\b(expensive|pricey|costly|too much|too high|high price|steep|overpriced|cheaper|cheap|lower|reduce|reduction|discount|discounts|coupon|promo|promo ?code|voucher|budget|afford|cost less|better price|best price|special offers?|better offer|do better|any offers?|negotiat\w*|bargain|knock|waive|price drop)\b|%\s*off|percent off|\boff (?:the )?price|\d{1,2}\s*%/;
const CODE_RE = /\b(save\d+|closenow\d+|[a-z]{4,}\d{2,3})\b/g;

export function extractDiscountRequest(raw) {
  const t = norm(raw);
  const codes = [];
  let m;
  while ((m = CODE_RE.exec(t))) {
    const c = m[1].toUpperCase();
    if (/^(save|closenow)/i.test(c) || /\b(code|promo|coupon|voucher)\b/.test(t)) codes.push(c);
  }
  const pct = t.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  const codeAfterWord = t.match(/\b(?:code|promo|coupon|voucher)\s+([a-z0-9]{4,})\b/);
  if (codeAfterWord) codes.push(codeAfterWord[1].toUpperCase());
  const uniq = [...new Set(codes)];
  if (!uniq.length && !pct) return null;
  return { codes: uniq, percent: pct ? Number(pct[1]) : null };
}

const looseSim = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length);

/** Merge deterministic extraction with (optional, untrusted) LLM output. Deterministic wins on anything safety-critical. */
export function buildSignals(rawMessage, nlu, catalog) {
  const text = String(rawMessage || '');
  const n = norm(text);

  // ---- product: raw message is authoritative; LLM text only accepted if grounded in the raw words
  let product = matchProduct([text], catalog);
  const llmProduct = nlu?.product_text && String(nlu.product_text).trim();
  if (product.status === 'ABSENT' && llmProduct) {
    const viaLlm = matchProduct([llmProduct], catalog);
    if (viaLlm.status === 'NONE') product = viaLlm;
    else if (viaLlm.status === 'MATCH') {
      const rawWords = n.split(' ');
      const llmWords = norm(llmProduct).split(' ');
      const grounded = rawWords.some((rw) => rw.length >= 4 && llmWords.some((lw) => lw.length >= 4 && looseSim(rw, lw) >= 0.6));
      if (grounded) product = viaLlm;
    }
  }

  // ---- count: deterministic first; LLM number only if that digit really appears in the message
  let count = extractCount(text);
  if (!count && nlu?.count?.value && n.includes(String(nlu.count.value))) {
    count = { value: Number(nlu.count.value), kind: nlu.count.unit_type === 'units' ? 'units' : 'capacity' };
  }
  if (count && (!Number.isInteger(count.value) || count.value < 1)) count = { invalid: true, value: count.value };

  const plan = extractPlan(text) ?? (['STD', 'PRO', 'CARE'].includes(nlu?.plan) && n.includes(String(nlu.plan).toLowerCase().slice(0, 3)) ? nlu.plan : null);

  const discountRequest = extractDiscountRequest(text);
  const regexObjection = OBJECTION_RE.test(n) || !!discountRequest;
  const llmObjection = !!nlu?.price_objection && /\b(price|cost|pay|expens|cheap|afford|much|budget|discount|offer|deal)\w*/.test(n);
  const objection = regexObjection || llmObjection;

  const cancel = CANCEL_RE.test(n);
  const regexConfirm = CONFIRM_RE.test(n) && !NEGATION_RE.test(n) && !cancel && !objection;
  // LLM may only veto a confirmation, never create one.
  const confirm = regexConfirm && nlu?.confirm !== false;
  const confirmVetoed = regexConfirm && nlu?.confirm === false;

  const asksCatalog = /\b(catalog|catalogue|what (?:do|can) you (?:sell|offer|have)|products|available|options|list|price list|what.*(?:sell|offer))\b/.test(n);
  const asksHelp = /\b(hi|hello|hey|help)\b/.test(n);

  return { rawMessage: text, product, count, plan, objection, discountRequest, confirm, confirmVetoed, cancel, asksCatalog, asksHelp };
}

export { ALLOWED_CODES };

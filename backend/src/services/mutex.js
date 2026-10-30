// Per-key async mutex: turns for one conversation run strictly one at a time (in this process).
const tails = new Map();
export function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  tails.set(key, tail);
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}

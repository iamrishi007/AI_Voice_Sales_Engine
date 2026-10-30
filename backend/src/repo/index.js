let current = null;
export const setRepo = (r) => { current = r; };
export const repo = new Proxy({}, { get: (_, k) => current[k] });

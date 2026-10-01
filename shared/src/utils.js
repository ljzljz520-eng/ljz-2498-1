export function deepClone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function stableStringify(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function shallowEqual(a = {}, b = {}) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.is(a[k], b[k]));
}

export function escapeHtml(input = '') {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function cssString(input = '') {
  return `"${String(input).replaceAll('\\', '\\\\').replaceAll('"', '\\22 ').replaceAll('\n', '\\A ')}"`;
}

export function nowIso() { return new Date().toISOString(); }

export function assert(condition, message, code = 'INVALID_INPUT', details) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    throw error;
  }
}

export function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

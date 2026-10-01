const j = async (r) => { const t = await r.text(); return t ? JSON.parse(t) : null; };
async function req(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = await j().catch(() => null) || { error: r.statusText };
    throw Object.assign(new Error(e.error || r.statusText), { status: r.status, details: e.details });
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('application/json') ? j(r) : r.text();
}
export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b || {}),
  put: (u, b) => req('PUT', u, b || {}),
  patch: (u, b) => req('PATCH', u, b || {}),
  del: (u) => req('DELETE', u),
};

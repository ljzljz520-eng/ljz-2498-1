async function request(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw payload.error ?? new Error(`HTTP ${response.status}`);
  return payload;
}

export const api = {
  health: () => request('/api/health'),
  listTemplates: () => request('/api/templates'),
  getDocument: id => request(`/api/documents/${id}`),
  listDocuments: () => request('/api/documents'),
  mutate: (id, operation, actor = '编辑者') => request(`/api/documents/${id}/mutate`, { method: 'POST', body: { operation, actor } }),
  split: (id, clauseId, payload) => request(`/api/documents/${id}/split`, { method: 'POST', body: { clauseId, ...payload } }),
  move: (id, clauseId, newParentId, index) => request(`/api/documents/${id}/move`, { method: 'POST', body: { clauseId, newParentId, index } }),
  setVariables: (id, values) => request(`/api/documents/${id}/variables`, { method: 'POST', body: { values } }),
  setSignoff: (id, signoff) => request(`/api/documents/${id}/signoff`, { method: 'POST', body: { signoff } }),
  compareReuse: (id, mappings) => request(`/api/documents/${id}/reuse-comparison`, { method: 'POST', body: { mappings } }),
  previewUpgrade: (id, targetVersionId) => request(`/api/documents/${id}/upgrades`, { method: 'POST', body: { targetVersionId } }),
  adoptUpgrade: (id, targetVersionId, choices) => request(`/api/documents/${id}/upgrades/${targetVersionId}/adopt`, { method: 'POST', body: { choices } }),
  createSnapshot: (id, reason = 'review') => request(`/api/documents/${id}/snapshots`, { method: 'POST', body: { reason } }),
  listSnapshots: id => request(`/api/documents/${id}/snapshots`),
  getSnapshot: id => request(`/api/snapshots/${id}`),
  review: (id, action, comment) => request(`/api/snapshots/${id}/review`, { method: 'POST', body: { action, comment } }),
  exportSnapshot: (id, format) => request(`/api/snapshots/${id}/export`, { method: 'POST', body: { format } })
};

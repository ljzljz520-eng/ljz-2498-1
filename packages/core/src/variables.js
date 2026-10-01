// Template variables and reuse migration.
// Syntax in bodies: {{name}} or {{name|fallback literal}}
// When reusing another template, a varMap records how SOURCE variables are
// satisfied in the target context. Unmapped required variables must block
// formal export (see validate.js).

const VAR_RE = /\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g;

export function parseVariables(text = '') {
  const out = [];
  VAR_RE.lastIndex = 0;
  let m;
  while ((m = VAR_RE.exec(text))) out.push({ name: m[1], fallback: m[2] ?? null, raw: m[0] });
  return out;
}

// Declared vars used in blocks (union of body/title references).
export function usedVariables(blocks) {
  const s = new Set();
  for (const b of blocks) {
    for (const v of parseVariables(b.title)) s.add(v.name);
    for (const v of parseVariables(b.body)) s.add(v.name);
  }
  return [...s];
}

// Resolve a single variable: explicit doc value -> varMap(literal/field) ->
// inline fallback -> template declared default -> undefined.
export function resolveVar(name, { values = {}, varMap = {}, inlineFallback, declared = [] } = {}) {
  if (values[name] !== undefined && values[name] !== '') return { value: values[name], source: 'value' };
  const mp = varMap[name];
  if (mp) {
    if (mp.mode === 'literal' && mp.value !== '') return { value: mp.value, source: 'map:literal' };
    if (mp.mode === 'field' && mp.field) {
      if (values[mp.field] !== undefined && values[mp.field] !== '') return { value: values[mp.field], source: `map:field:${mp.field}` };
      return { value: undefined, source: `map:field:${mp.field}`, missing: true };
    }
  }
  if (inlineFallback !== undefined && inlineFallback !== null) return { value: inlineFallback, source: 'fallback' };
  const d = declared.find((v) => v.name === name);
  if (d && d.default !== undefined && d.default !== '') return { value: d.default, source: 'default' };
  return { value: undefined, source: 'unresolved', missing: true };
}

// Substitute variables in text. Missing values are rendered with a visible
// marker in preview; formal export must never contain such markers.
export function substitute(text, ctx, { strict = false } = {}) {
  return text.replace(VAR_RE, (raw, name, fallback) => {
    const r = resolveVar(name, { ...ctx, inlineFallback: fallback ?? undefined });
    if (r.value === undefined) {
      if (strict) throw Object.assign(new Error(`unmapped variable: ${name}`), { code: 'UNMAPPED_VAR', variable: name });
      return `【未映射变量:${name}】`;
    }
    return r.value;
  });
}

// Build a migration proposal from a SOURCE template to a TARGET template.
// sourceVars: vars declared/used in source; targetVars: vars available target.
// Auto-maps exact name matches; the rest must be decided manually.
export function proposeVarMapping(sourceVars, targetVars) {
  const tnames = new Set(targetVars.map((v) => v.name || v));
  const varMap = {}, unmapped = [];
  for (const sv of sourceVars) {
    const name = sv.name || sv;
    if (tnames.has(name)) varMap[name] = { mode: 'field', field: name };
    else unmapped.push({ name, label: sv.label || null, required: !!sv.required });
  }
  return { varMap, unmapped };
}

// All variables that still lack a usable value.
export function unresolvedRequired(variables, ctx) {
  const missing = [];
  for (const v of variables) {
    const r = resolveVar(v.name, ctx);
    if (v.required !== false && r.missing) missing.push({ name: v.name, label: v.label || v.name });
  }
  return missing;
}

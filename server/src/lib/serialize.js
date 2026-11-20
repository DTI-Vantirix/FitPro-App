// Records leave the API the way Base44 returned them: plain JSON, timestamps as
// ISO strings, and fields that were never set left out rather than null.
export function serialize(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

export const MAX_POINTS = 4096;
export const MAX_STROKES = 256;
export const AUTHOR_PATTERN = /^[a-f0-9]{24}$/;

export function validRegion(r) {
  return r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) &&
    r.x >= 0 && r.y >= 0 && r.width >= 32 && r.height >= 32 &&
    r.x + r.width <= 32768 && r.y + r.height <= 32768;
}

export function validConfig(c) {
  return c && Number.isFinite(c.aspect) && c.aspect >= 0.2 && c.aspect <= 8;
}

export function validEvent(e) {
  if (!e || typeof e !== 'object') return false;
  if (e.type === 'clear') return true;
  if (e.type === 'clear-author') return AUTHOR_PATTERN.test(e.author ?? '');
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(e.id ?? '')) return false;
  if (e.type === 'end' || e.type === 'remove') return true;
  if (e.type !== 'start' && e.type !== 'points') return false;
  if (!Array.isArray(e.points) || e.points.length < 1 || e.points.length > 64 ||
      !e.points.every(p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 1))) return false;
  return e.type !== 'start' || ((e.undoGroup === undefined || (typeof e.undoGroup === 'string' && /^[a-zA-Z0-9-]{1,32}$/.test(e.undoGroup))) && /^#[0-9a-fA-F]{6}$/.test(e.color) &&
    Number.isFinite(e.width) && e.width >= 0.0005 && e.width <= 0.02 &&
    [0, 2000, 5000, 10000].includes(e.ttl));
}

// All geometry is in logical screen pixels; normalized wire coordinates are DPI-independent.
export function containRect(bounds, aspect) {
  const width = Math.min(bounds.width, bounds.height * aspect);
  const height = width / aspect;
  return { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + (bounds.height - height) / 2, width, height };
}

export function normalizePoint(x, y, r) {
  if (x < r.x || y < r.y || x > r.x + r.width || y > r.y + r.height) return null;
  return [(x - r.x) / r.width, (y - r.y) / r.height];
}

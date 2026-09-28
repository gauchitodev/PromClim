/**
 * Utilidades compartidas: pedidos HTTP con timeout, caché en memoria y
 * conversión de números.
 */

const UA = 'promclim/0.1 (agregador personal de pronosticos)';

/** GET que devuelve JSON. Tira error con el código HTTP si no es 2xx. */
export async function pedirJSON(url, { headers = {}, timeout = 12_000 } = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------------------
// Caché: guarda la promesa, así dos pedidos simultáneos al mismo lugar
// comparten una sola consulta a la fuente. Si falla, se borra.
// ---------------------------------------------------------------------------

const cache = new Map();

export function conCache(clave, ttl, fn) {
  const e = cache.get(clave);
  if (e && Date.now() - e.t < ttl) return e.p;
  const p = fn();
  cache.set(clave, { t: Date.now(), p });
  p.catch(() => cache.delete(clave));
  if (cache.size > 1000) limpiar();
  return p;
}

function limpiar() {
  const viejo = Date.now() - 86_400_000;
  for (const [k, e] of cache) if (e.t < viejo) cache.delete(k);
}

/** Número o null (acepta strings tipo "07" o "1.4"). */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coordenada redondeada para claves de caché (~1 km). */
export const redondo = (x) => Number(x).toFixed(2);

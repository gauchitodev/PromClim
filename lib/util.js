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

/** Fecha local YYYY-MM-DD de un instante en una zona horaria. */
export function fechaLocal(fecha, zona) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(fecha);
  } catch {
    return fecha.toISOString().slice(0, 10);
  }
}

/**
 * Pasa una serie cada 1, 3 o 6 horas a días locales:
 * máxima y mínima de temp, lluvia sumada, probabilidad y viento máximos.
 * Cada punto: { t: Date, horas, temp, lluvia, prob, viento } (null si falta;
 * temp puede ser una lista, p. ej. [máx, mín] de un período de 6 h).
 * Descarta días con menos de 18 h de datos: hoy suele quedar afuera porque ya
 * va empezado, y con medio día la máxima, la mínima y la lluvia salen mal.
 */
export function agruparPorDia(puntos, zona) {
  const dias = new Map();
  for (const p of puntos) {
    const fecha = fechaLocal(p.t, zona);
    if (!dias.has(fecha)) dias.set(fecha, { temps: [], lluvia: null, prob: null, viento: null, horas: 0 });
    const d = dias.get(fecha);
    d.horas += p.horas;
    for (const x of [].concat(p.temp ?? [])) if (x !== null) d.temps.push(x);
    if (p.lluvia !== null) d.lluvia = (d.lluvia ?? 0) + p.lluvia;
    if (p.prob !== null) d.prob = Math.max(d.prob ?? 0, p.prob);
    if (p.viento !== null) d.viento = Math.max(d.viento ?? 0, p.viento);
  }
  return [...dias]
    .filter(([, d]) => d.horas >= 18)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, d]) => ({
      fecha,
      max: d.temps.length ? Math.max(...d.temps) : null,
      min: d.temps.length ? Math.min(...d.temps) : null,
      lluvia: d.lluvia === null ? null : Math.round(d.lluvia * 10) / 10,
      prob: d.prob,
      viento: d.viento === null ? null : Math.round(d.viento),
    }));
}

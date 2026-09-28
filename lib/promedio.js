/**
 * El promedio. Cada fuente aporta una lista de días
 * { fecha, max, min, lluvia, prob, viento } con null donde no tiene dato.
 */

export const CAMPOS = ['max', 'min', 'lluvia', 'prob', 'viento'];

const r1 = (x) => Math.round(x * 10) / 10;

/** Junta los valores de cada campo por fecha: { fecha: { max: [..], ... } }. */
function agrupar(listas) {
  const porFecha = new Map();
  for (const dias of listas) {
    for (const d of dias) {
      if (!porFecha.has(d.fecha)) {
        porFecha.set(d.fecha, Object.fromEntries(CAMPOS.map((c) => [c, []])));
      }
      const g = porFecha.get(d.fecha);
      for (const c of CAMPOS) if (d[c] !== null && d[c] !== undefined) g[c].push(d[c]);
    }
  }
  return [...porFecha].sort(([a], [b]) => a.localeCompare(b));
}

/** Promedio simple por día (lo usa Open-Meteo para juntar sus modelos). */
export function promediarListas(listas) {
  return agrupar(listas).map(([fecha, g]) => {
    const dia = { fecha };
    for (const c of CAMPOS) {
      dia[c] = g[c].length ? r1(g[c].reduce((s, x) => s + x, 0) / g[c].length) : null;
    }
    return dia;
  });
}

/**
 * Promedio general con detalle: para cada campo devuelve
 * { prom, min, max, n } (n = cuántas fuentes tenían ese dato).
 * Descarta días anteriores a `hoy`.
 */
export function promedioGeneral(listas, hoy) {
  return agrupar(listas)
    .filter(([fecha]) => !hoy || fecha >= hoy)
    .map(([fecha, g]) => {
      const dia = { fecha };
      for (const c of CAMPOS) {
        const v = g[c];
        dia[c] = v.length
          ? { prom: r1(v.reduce((s, x) => s + x, 0) / v.length),
              min: r1(Math.min(...v)), max: r1(Math.max(...v)), n: v.length }
          : null;
      }
      return dia;
    })
    .filter((d) => d.max || d.min);
}

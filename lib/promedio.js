/**
 * El promedio. Cada fuente aporta una lista de días
 * { fecha, max, min, lluvia, prob, viento } con null donde no tiene dato.
 */

export const CAMPOS = ['max', 'min', 'lluvia', 'prob', 'viento'];

/** Desde cuántos mm un día cuenta como "llueve". */
export const LLUVIA_MM = 1;

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Junta los valores de cada campo por fecha: { fecha: { max: [{ v, w }], ... } }.
 * `pesos[i]` es el peso de la lista i: { temp, lluvia } (1 si no hay).
 */
function agrupar(listas, pesos = []) {
  const porFecha = new Map();
  listas.forEach((dias, i) => {
    const p = pesos[i] || {};
    const peso = { max: p.temp, min: p.temp, lluvia: p.lluvia, prob: p.lluvia };
    for (const d of dias) {
      if (!porFecha.has(d.fecha)) {
        porFecha.set(d.fecha, Object.fromEntries(CAMPOS.map((c) => [c, []])));
      }
      const g = porFecha.get(d.fecha);
      for (const c of CAMPOS) {
        if (d[c] !== null && d[c] !== undefined) g[c].push({ v: d[c], w: peso[c] ?? 1 });
      }
    }
  });
  return [...porFecha].sort(([a], [b]) => a.localeCompare(b));
}

const mediaPesada = (xs) => xs.reduce((s, x) => s + x.v * x.w, 0) / xs.reduce((s, x) => s + x.w, 0);

/** Promedio simple por día (lo usa Open-Meteo para juntar sus modelos). */
export function promediarListas(listas) {
  return agrupar(listas).map(([fecha, g]) => {
    const dia = { fecha };
    for (const c of CAMPOS) dia[c] = g[c].length ? r1(mediaPesada(g[c])) : null;
    return dia;
  });
}

/**
 * Promedio general con detalle: para cada campo devuelve
 * { prom, min, max, n } (n = cuántas fuentes tenían ese dato).
 * Descarta días anteriores a `hoy`. Con `pesos`, el promedio es ponderado
 * (el mínimo, el máximo y "cuántas dan lluvia" no cambian).
 */
export function promedioGeneral(listas, hoy, pesos) {
  return agrupar(listas, pesos)
    .filter(([fecha]) => !hoy || fecha >= hoy)
    .map(([fecha, g]) => {
      const dia = { fecha };
      for (const c of CAMPOS) {
        const v = g[c].map((x) => x.v);
        dia[c] = v.length
          ? { prom: r1(mediaPesada(g[c])), min: r1(Math.min(...v)), max: r1(Math.max(...v)), n: v.length }
          : null;
      }
      // Cuántas fuentes dan lluvia (1 mm o más) ese día.
      dia.llueve = g.lluvia.length
        ? { si: g.lluvia.filter((x) => x.v >= LLUVIA_MM).length, de: g.lluvia.length }
        : null;
      return dia;
    })
    .filter((d) => d.max || d.min);
}

/** El promedio en el formato de una fuente más, para guardarlo y verificarlo. */
export const comoFuente = (promedio) => promedio.map((d) => ({
  fecha: d.fecha, max: d.max?.prom ?? null, min: d.min?.prom ?? null, lluvia: d.lluvia?.prom ?? null,
}));

/**
 * Lluvia acumulada en los próximos 3 y 7 días (contando hoy): la del promedio
 * y la de cada fuente. `dias` dice cuántos días de la ventana cubre la fuente,
 * porque algunas (AccuWeather, wttr.in) no llegan a 7.
 */
export function acumulados(fuentes, promedio) {
  const ventanas = { d3: promedio.slice(0, 3), d7: promedio.slice(0, 7) };
  const suma = (xs) => r1(xs.reduce((s, x) => s + x, 0));

  const resultado = { promedio: {}, fuentes: [] };
  for (const [clave, dias] of Object.entries(ventanas)) {
    resultado.promedio[clave] = suma(dias.map((d) => d.lluvia?.prom ?? 0));
  }
  for (const f of fuentes) {
    const fila = { nombre: f.nombre };
    for (const [clave, dias] of Object.entries(ventanas)) {
      const fechas = new Set(dias.map((d) => d.fecha));
      const conDato = f.dias.filter((d) => fechas.has(d.fecha) && d.lluvia !== null);
      fila[clave] = conDato.length ? { mm: suma(conDato.map((d) => d.lluvia)), dias: conDato.length, de: dias.length } : null;
    }
    if (fila.d3 || fila.d7) resultado.fuentes.push(fila);
  }
  return resultado;
}

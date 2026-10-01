/**
 * Historial de aciertos: el reporte de "ayer", pero para cada uno de los
 * últimos días que tienen medición de la estación de INUMET.
 *
 * Para cada día se compara lo medido con lo que se pronosticaba un día antes:
 * el promedio que guardó PromClim o, si ese día no se guardó, lo que daba
 * Open-Meteo un día antes (su "Previous Runs API" guarda el pasado, así que
 * el historial arranca lleno aunque PromClim sea nuevo en ese lugar).
 */
import { conCache, fechaLocal, num, pedirJSON, redondo } from './util.js';
import { LLUVIA_MM } from './promedio.js';
import { conclusiones, tempOk } from './ayer.js';
import {
  bajarObservaciones, emisiones, estacionCercana, observacionesGuardadas, observacionesPorDia,
  PROMEDIO_PONDERADO, PROMEDIO_SIMPLE,
} from './verificacion.js';

export const DIAS_HISTORIAL = 30;
const LLUVIA_OK = 3;      // mm de diferencia, si además acertó que llovía o no

const sumarDias = (fecha, n) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Lo que daba Open-Meteo un día antes, para cada día del rango: { fecha: { max, min, lluvia } }. */
function openMeteoRango(lugar, desde, hasta) {
  return conCache(`previo-rango:${redondo(lugar.lat)},${redondo(lugar.lon)}:${desde}:${hasta}`, 3 * 3600e3, async () => {
    const q = new URLSearchParams({
      latitude: lugar.lat,
      longitude: lugar.lon,
      hourly: 'temperature_2m_previous_day1,precipitation_previous_day1',
      timezone: lugar.zona,
      start_date: desde,
      end_date: hasta,
    });
    const { hourly } = await pedirJSON(`https://previous-runs-api.open-meteo.com/v1/forecast?${q}`);
    const porDia = {};
    hourly.time.forEach((t, i) => {
      const d = porDia[t.slice(0, 10)] ||= { temps: [], lluvias: [] };
      const temp = num(hourly.temperature_2m_previous_day1[i]);
      const lluvia = num(hourly.precipitation_previous_day1[i]);
      if (temp !== null) d.temps.push(temp);
      if (lluvia !== null) d.lluvias.push(lluvia);
    });
    return Object.fromEntries(Object.entries(porDia).map(([fecha, d]) => [fecha, {
      max: d.temps.length >= 20 ? Math.max(...d.temps) : null,
      min: d.temps.length >= 20 ? Math.min(...d.temps) : null,
      lluvia: d.lluvias.length >= 20 ? Math.round(Math.max(0, d.lluvias.reduce((s, x) => s + x, 0)) * 10) / 10 : null,
    }]));
  });
}

/** Si el pronóstico acertó: { temp, lluvia } con true, false o null (sin dato). */
export function acerto(real, pron) {
  const temps = ['max', 'min'].filter((c) => real[c] != null && pron[c] != null);
  return {
    temp: temps.length ? temps.every((c) => tempOk(real[c], pron[c])) : null,
    lluvia: real.lluvia != null && pron.lluvia != null
      ? (real.lluvia >= LLUVIA_MM) === (pron.lluvia >= LLUVIA_MM) && Math.abs(real.lluvia - pron.lluvia) < LLUVIA_OK
      : null,
  };
}

/**
 * El historial de un lugar, con `nombres` = { idFuente: nombre } para las
 * frases. Devuelve los días del más nuevo al más viejo y un resumen, o null
 * si no hay estación cerca.
 */
export async function historial(lugar, nombres = {}) {
  const crudo = await bajarObservaciones();
  const est = estacionCercana(crudo, lugar.lat, lugar.lon);
  if (!est) return null;
  const hoy = fechaLocal(new Date(), lugar.zona);
  // Lo guardado más lo que INUMET publica ahora (últimas 72 horas).
  const obs = { ...observacionesGuardadas(est.id), ...(observacionesPorDia(crudo, lugar.zona)[est.id] || {}) };
  const desde = sumarDias(hoy, -DIAS_HISTORIAL);
  const fechas = Object.keys(obs).filter((f) => f >= desde && f < hoy && obs[f].max != null).sort().reverse();
  if (!fechas.length) return { estacion: est, dias: [], resumen: null };

  const guardadas = emisiones(lugar);
  const faltan = fechas.filter((f) => !guardadas[sumarDias(f, -1)]);
  const previoOM = faltan.length
    ? await openMeteoRango(lugar, faltan.at(-1), faltan[0]).catch((e) => {
      console.warn('[historial]', e.message);
      return {};
    })
    : {};

  const dias = [];
  for (const fecha of fechas) {
    const guardado = guardadas[sumarDias(fecha, -1)] || {};
    const delDia = (id) => {
      const d = guardado[id]?.find((x) => x.fecha === fecha);
      return d ? { max: d.max, min: d.min, lluvia: d.lluvia } : null;
    };
    let pron = delDia(PROMEDIO_PONDERADO) || delDia(PROMEDIO_SIMPLE);
    let origen = 'promedio';
    if (!pron && previoOM[fecha]?.max != null) {
      pron = previoOM[fecha];
      origen = 'openmeteo';
    }
    if (!pron) continue;
    const fuentes = Object.keys(guardado)
      .filter((id) => !id.startsWith('_') && delDia(id))
      .map((id) => ({ nombre: nombres[id] || id, ...delDia(id) }));
    const real = { max: obs[fecha].max, min: obs[fecha].min, lluvia: obs[fecha].lluvia ?? null };
    dias.push({
      fecha,
      real,
      pronostico: { ...pron, origen },
      acierto: acerto(real, pron),
      frases: conclusiones(real, pron, fuentes),
    });
  }

  const contar = (campo) => {
    const con = dias.filter((d) => d.acierto[campo] != null);
    return { aciertos: con.filter((d) => d.acierto[campo]).length, de: con.length };
  };
  const media = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 10) / 10 : null);
  return {
    estacion: est,
    dias,
    resumen: dias.length ? {
      temp: contar('temp'),
      lluvia: contar('lluvia'),
      errorMax: media(dias.filter((d) => d.pronostico.max != null).map((d) => Math.abs(d.real.max - d.pronostico.max))),
      errorMin: media(dias.filter((d) => d.real.min != null && d.pronostico.min != null).map((d) => Math.abs(d.real.min - d.pronostico.min))),
      deOpenMeteo: dias.filter((d) => d.pronostico.origen === 'openmeteo').length,
    } : null,
  };
}

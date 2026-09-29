/**
 * "Ayer": lo que midió la estación de INUMET al lado de lo que se había
 * pronosticado el día anterior, con las conclusiones ya escritas.
 *
 * El pronóstico de referencia es el promedio que PromClim guardó un día antes
 * (ver verificacion.js). Si ese día no se guardó (la compu estaba apagada, o
 * el lugar es nuevo), se usa lo que pronosticaba Open-Meteo un día antes, que
 * Open-Meteo guarda en su "Previous Runs API". De ahí sale siempre la curva
 * hora por hora, porque PromClim guarda solo los valores del día.
 *
 * Las frases las arma el código y no la IA: así salen al instante y los
 * números no se equivocan.
 */
import { conCache, fechaLocal, num, pedirJSON, redondo } from './util.js';
import { LLUVIA_MM } from './promedio.js';
import { ahora, horasDelDia, serieEstacion } from './estacion.js';
import {
  bajarObservaciones, emision, estacionCercana, observacionesPorDia,
  PROMEDIO_PONDERADO, PROMEDIO_SIMPLE,
} from './verificacion.js';

const TEMP_OK = 1.5;   // hasta cuántos grados de diferencia "salió como se esperaba"

const diaAntes = (fecha) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const g = (x) => `${Math.round(x)}°`;
const mm = (x) => (x > 0 && x < 1 ? `${x} mm` : `${Math.round(x)} mm`);
const fuentesTexto = (n) => `${n} ${n === 1 ? 'fuente' : 'fuentes'}`;

/** Lo que pronosticaba Open-Meteo (su mejor modelo para el lugar) un día antes, hora por hora. */
export function openMeteoDiaAntes(lugar, fecha) {
  return conCache(`previo:${redondo(lugar.lat)},${redondo(lugar.lon)}:${fecha}`, 3 * 3600e3, async () => {
    const q = new URLSearchParams({
      latitude: lugar.lat,
      longitude: lugar.lon,
      hourly: 'temperature_2m_previous_day1,precipitation_previous_day1',
      timezone: lugar.zona,
      start_date: fecha,
      end_date: fecha,
    });
    const { hourly } = await pedirJSON(`https://previous-runs-api.open-meteo.com/v1/forecast?${q}`);
    const horas = hourly.time.map((t, i) => ({
      hora: Number(t.slice(11, 13)),
      temp: num(hourly.temperature_2m_previous_day1[i]),
      lluvia: num(hourly.precipitation_previous_day1[i]),
    }));
    const temps = horas.map((h) => h.temp).filter((x) => x !== null);
    const lluvias = horas.map((h) => h.lluvia).filter((x) => x !== null);
    return {
      horas,
      max: temps.length >= 20 ? Math.max(...temps) : null,
      min: temps.length >= 20 ? Math.min(...temps) : null,
      lluvia: lluvias.length >= 20 ? Math.round(Math.max(0, lluvias.reduce((s, x) => s + x, 0)) * 10) / 10 : null,
    };
  });
}

/**
 * Las conclusiones del día, en frases. `real` y `pron` = { max, min, lluvia };
 * `fuentes` = [{ nombre, max, min, lluvia }] con lo que dijo cada una (puede
 * estar vacío); `rafaga` = la ráfaga más fuerte medida, en km/h.
 */
export function conclusiones(real, pron, fuentes = [], rafaga = null) {
  const frases = [];

  // Temperatura
  const partes = [];
  for (const [campo, nombre] of [['max', 'máxima'], ['min', 'mínima']]) {
    if (real[campo] == null || pron[campo] == null) continue;
    const d = real[campo] - pron[campo];
    partes.push({ nombre, real: real[campo], pron: pron[campo], d, ok: Math.abs(d) < TEMP_OK });
  }
  if (partes.length && partes.every((p) => p.ok)) {
    frases.push(`Las temperaturas salieron como se esperaba: ${partes.map((p) => `${p.nombre} de ${g(p.real)}`).join(' y ')}.`);
  } else {
    for (const p of partes) {
      const cuanto = Math.round(Math.abs(p.d));
      frases.push(p.ok
        ? `La ${p.nombre} salió como se esperaba: ${g(p.real)}.`
        : `La ${p.nombre} fue de ${g(p.real)}: ${cuanto}° ${p.d > 0 ? 'más' : 'menos'} de lo pronosticado (${g(p.pron)}).`);
    }
  }

  // Lluvia
  if (real.lluvia != null && pron.lluvia != null) {
    const r = real.lluvia, p = pron.lluvia;
    const conLluvia = fuentes.filter((f) => f.lluvia != null);
    const daban = conLluvia.filter((f) => f.lluvia >= LLUVIA_MM).length;
    const quienes = conLluvia.length >= 2
      ? (daban ? ` La daban ${daban} de ${fuentesTexto(conLluvia.length)}.` : ' Ninguna fuente la anticipó.')
      : '';
    if (r >= LLUVIA_MM && p < LLUVIA_MM) {
      frases.push(`Llovieron ${mm(r)} y el pronóstico no lo esperaba.${quienes}`);
    } else if (r < LLUVIA_MM && p >= LLUVIA_MM) {
      frases.push(`Se esperaban ${mm(p)} y ${r > 0 ? `casi no llovió (${mm(r)})` : 'no llovió'}.`
        + (conLluvia.length >= 2 ? ` La daban ${daban} de ${fuentesTexto(conLluvia.length)}.` : ''));
    } else if (r >= LLUVIA_MM) {
      if (r > p * 1.5 && r - p >= 3) frases.push(`Llovió más de lo esperado: ${mm(r)} contra ${mm(p)} pronosticados.`);
      else if (r < p / 1.5 && p - r >= 3) frases.push(`Llovió menos de lo esperado: ${mm(r)} contra ${mm(p)} pronosticados.`);
      else frases.push(`Llovió lo que se esperaba: ${mm(r)} (se pronosticaban ${mm(p)}).`);
    } else {
      frases.push('No llovió, como se esperaba.');
    }
  }

  // Quién se acercó más
  const conTemp = fuentes
    .filter((f) => f.max != null && f.min != null && real.max != null && real.min != null)
    .map((f) => ({ nombre: f.nombre, error: (Math.abs(f.max - real.max) + Math.abs(f.min - real.min)) / 2 }))
    .sort((a, b) => a.error - b.error);
  if (conTemp.length >= 2) {
    const [mejor] = conTemp;
    frases.push(mejor.error < 0.5
      ? `En temperatura, la que más se acercó fue ${mejor.nombre}: le pegó casi justo.`
      : `En temperatura, la que más se acercó fue ${mejor.nombre}: le erró por ${Math.round(mejor.error * 10) / 10}° en promedio.`);
  }
  if (real.lluvia != null && (real.lluvia >= LLUVIA_MM || pron.lluvia >= LLUVIA_MM)) {
    const conLluvia = fuentes.filter((f) => f.lluvia != null)
      .map((f) => ({ nombre: f.nombre, lluvia: f.lluvia, error: Math.abs(f.lluvia - real.lluvia) }))
      .sort((a, b) => a.error - b.error);
    if (conLluvia.length >= 2) {
      frases.push(`En lluvia, la más cercana fue ${conLluvia[0].nombre}, que dio ${mm(conLluvia[0].lluvia)}.`);
    }
  }

  if (rafaga != null && rafaga >= 50) frases.push(`Hubo ráfagas de hasta ${Math.round(rafaga)} km/h.`);
  return frases;
}

/**
 * Todo lo de la estación para la página: cómo está ahora y cómo fue ayer.
 * `nombres` = { idFuente: nombre } para las frases. Devuelve null si no hay
 * estación cerca.
 */
export async function estacionYAyer(lugar, nombres = {}) {
  const crudo = await bajarObservaciones();
  const est = estacionCercana(crudo, lugar.lat, lugar.lon);
  if (!est) return null;
  const serie = serieEstacion(crudo, est.id);

  const fecha = diaAntes(fechaLocal(new Date(), lugar.zona));
  const obs = observacionesPorDia(crudo, lugar.zona)[est.id]?.[fecha];
  if (!obs || obs.max == null) return { estacion: est, ahora: ahora(serie), ayer: null };
  const { horas, rafaga } = horasDelDia(serie, fecha, lugar.zona);

  const previoOM = await openMeteoDiaAntes(lugar, fecha).catch((e) => {
    console.warn('[ayer]', e.message);
    return null;
  });

  // Lo que guardó PromClim un día antes para ese día.
  const guardado = emision(lugar, diaAntes(fecha)) || {};
  const delDia = (id) => {
    const d = guardado[id]?.find((x) => x.fecha === fecha);
    return d ? { max: d.max, min: d.min, lluvia: d.lluvia } : null;
  };
  const fuentes = Object.keys(guardado)
    .filter((id) => !id.startsWith('_') && delDia(id))
    .map((id) => ({ id, nombre: nombres[id] || id, ...delDia(id) }));

  let pron = delDia(PROMEDIO_PONDERADO) || delDia(PROMEDIO_SIMPLE);
  let origen = pron ? 'promedio' : null;
  if (!pron && previoOM?.max != null) {
    pron = { max: previoOM.max, min: previoOM.min, lluvia: previoOM.lluvia };
    origen = 'openmeteo';
  }
  if (!pron) return { estacion: est, ahora: ahora(serie), ayer: null };

  const real = { max: obs.max, min: obs.min, lluvia: obs.lluvia ?? null };
  return {
    estacion: est,
    ahora: ahora(serie),
    ayer: {
      fecha,
      real: { ...real, rafaga },
      pronostico: { ...pron, origen },
      fuentes: fuentes.map((f) => ({
        ...f,
        errorMax: f.max != null ? Math.round((f.max - real.max) * 10) / 10 : null,
        errorMin: f.min != null && real.min != null ? Math.round((f.min - real.min) * 10) / 10 : null,
      })),
      frases: conclusiones(real, pron, fuentes, rafaga),
      horas: horas.map((h) => ({ ...h, pron: previoOM?.horas.find((x) => x.hora === h.hora)?.temp ?? null })),
    },
  };
}

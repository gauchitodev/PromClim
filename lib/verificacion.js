/**
 * Verificación: compara lo que pronosticó cada fuente con lo que midió la
 * estación automática de INUMET más cercana, para saber quién acierta más
 * en cada lugar y darle más peso en el promedio.
 *
 * - Cada día se guarda lo que pronostica cada fuente (y el promedio) para
 *   los días siguientes: una "emisión" por lugar y por día.
 * - INUMET publica solo las últimas 72 horas de sus estaciones, así que las
 *   observaciones también se guardan (máxima, mínima y lluvia de cada día).
 * - Solo se evalúan pronósticos hechos al menos un día antes: el de hoy para
 *   hoy es demasiado fácil y a la noche es casi una observación.
 *
 * Todo vive en ~/.local/share/promclim (o $PROMCLIM_DATOS), en JSON.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { conCache, fechaLocal, pedirJSON } from './util.js';

const URL_OBS = 'https://www.inumet.gub.uy/reportes/estadoActual/datos_inumet_ui_publica.mch';

export const MIN_DIAS_PONDERAR = 14;   // días verificados por fuente para darle peso propio
const MAX_KM_ESTACION = 40;            // más lejos, la estación no representa al lugar
const MIN_HORAS_DIA = 20;              // horas con dato para dar por bueno un día observado
const GUARDAR_DIAS = 120;              // emisiones y observaciones más viejas se borran
const LLUVIA_MM = 1;                   // desde cuánto un día cuenta como "llovió"

// Nombres internos para el promedio dentro de las emisiones.
export const PROMEDIO_SIMPLE = '_simple';
export const PROMEDIO_PONDERADO = '_ponderado';

// ---------------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------------

function carpetaDatos() {
  if (process.env.PROMCLIM_DATOS) return process.env.PROMCLIM_DATOS;
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'promclim');
}

function leer(nombre) {
  try {
    return JSON.parse(readFileSync(path.join(carpetaDatos(), nombre), 'utf8'));
  } catch {
    return {};
  }
}

/** Escribe a un temporal y lo renombra: si se corta la luz, no queda un JSON a medias. */
function escribir(nombre, datos) {
  const carpeta = carpetaDatos();
  mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, nombre);
  writeFileSync(`${destino}.tmp`, JSON.stringify(datos));
  renameSync(`${destino}.tmp`, destino);
}

const hace = (dias, desde) => {
  const d = new Date(`${desde}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
};

const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86_400_000);

export const claveLugar = (lugar) => `${lugar.lat.toFixed(2)},${lugar.lon.toFixed(2)}`;

// ---------------------------------------------------------------------------
// Estaciones y observaciones de INUMET
// ---------------------------------------------------------------------------

function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const bajarObservaciones = () => conCache('inumet-obs', 30 * 60e3, () => pedirJSON(URL_OBS, { timeout: 20_000 }));

/**
 * Pasa el formato de INUMET (variables × estaciones × horas) a días por
 * estación: { idEstacion: { "2026-10-01": { max, min, lluvia } } }.
 * La lluvia de cada hora es la acumulada en la hora anterior, así que se
 * asigna al día de media hora antes.
 */
export function observacionesPorDia(crudo, zona) {
  const iVar = (id) => crudo.variables.findIndex((v) => v.idStr === id);
  const temp = crudo.observaciones[iVar('TempAire')];
  const lluvia = crudo.observaciones[iVar('precipHoraria')];
  const hoy = fechaLocal(new Date(), zona);
  const resultado = {};

  crudo.estaciones.forEach((est, e) => {
    const dias = {};
    const sumar = (serie, campo) => {
      if (!serie) return;
      serie.iFechas.forEach((iF, j) => {
        const v = serie.datos[e]?.[j];
        const n = v === null || v === undefined || v === '' ? null : Number(v);
        if (n === null || !Number.isFinite(n)) return;
        const t = new Date(crudo.fechas[iF]);
        const fecha = fechaLocal(new Date(t.getTime() - (campo === 'lluvia' ? 30 * 60e3 : 0)), zona);
        (dias[fecha] ||= { temps: [], lluvias: [] })[campo === 'lluvia' ? 'lluvias' : 'temps'].push(n);
      });
    };
    sumar(temp, 'temp');
    sumar(lluvia, 'lluvia');

    for (const [fecha, d] of Object.entries(dias)) {
      if (fecha >= hoy) continue; // el día de hoy todavía no terminó
      const dia = {};
      if (d.temps.length >= MIN_HORAS_DIA) {
        dia.max = Math.max(...d.temps);
        dia.min = Math.min(...d.temps);
      }
      if (d.lluvias.length >= MIN_HORAS_DIA) {
        dia.lluvia = Math.round(d.lluvias.reduce((s, x) => s + x, 0) * 10) / 10;
      }
      if (Object.keys(dia).length) (resultado[est.id] ||= {})[fecha] = dia;
    }
  });
  return resultado;
}

/** La estación automática más cercana con datos completos, o null si no hay a menos de 40 km. */
export function estacionCercana(crudo, lat, lon) {
  const iTemp = crudo.variables.findIndex((v) => v.idStr === 'TempAire');
  const iLluvia = crudo.variables.findIndex((v) => v.idStr === 'precipHoraria');
  const horas = crudo.fechas.length;
  let mejor = null;
  crudo.estaciones.forEach((est, e) => {
    if (!est.tipoAutomatica || !Number.isFinite(est.latitud) || !Number.isFinite(est.longitud)) return;
    const completas = [iTemp, iLluvia].every((i) => {
      const fila = crudo.observaciones[i]?.datos?.[e] || [];
      return fila.filter((v) => v !== null && v !== '').length >= horas * 0.8;
    });
    if (!completas) return;
    const d = km(lat, lon, est.latitud, est.longitud);
    if (d <= MAX_KM_ESTACION && (!mejor || d < mejor.km)) {
      mejor = { id: est.id, nombre: est.displayNamePublic || est.nombre, km: Math.round(d * 10) / 10 };
    }
  });
  return mejor;
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/**
 * Guarda lo que pronostica cada fuente hoy para este lugar (una vez por día,
 * desde las 6 de la mañana). `promedios` = { _simple: [...], _ponderado: [...] }.
 */
export function registrarPronostico(lugar, fuentes, promedios) {
  const ahora = new Date();
  const hoy = fechaLocal(ahora, lugar.zona);
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: lugar.zona, hour: '2-digit', hour12: false }).format(ahora));
  if (hora < 6) return false;

  const todo = leer('pronosticos.json');
  const clave = claveLugar(lugar);
  const reg = todo[clave] ||= { lugar: { nombre: lugar.nombre, lat: lugar.lat, lon: lugar.lon, zona: lugar.zona }, emisiones: {} };
  if (reg.emisiones[hoy]) return false;

  const recortar = (dias) => dias
    .filter((d) => d.fecha > hoy)
    .map(({ fecha, max, min, lluvia }) => ({ fecha, max, min, lluvia }))
    .filter((d) => d.max !== null || d.min !== null || d.lluvia !== null);

  const emision = {};
  for (const f of fuentes.filter((x) => x.estado === 'ok')) {
    const dias = recortar(f.dias);
    if (dias.length) emision[f.id] = dias;
  }
  for (const [id, dias] of Object.entries(promedios)) {
    if (dias) emision[id] = recortar(dias);
  }
  reg.emisiones[hoy] = emision;
  reg.lugar.nombre = lugar.nombre;

  const limite = hace(GUARDAR_DIAS, hoy);
  for (const r of Object.values(todo)) {
    for (const f of Object.keys(r.emisiones)) if (f < limite) delete r.emisiones[f];
  }
  escribir('pronosticos.json', todo);
  return true;
}

/**
 * Baja las observaciones de INUMET y guarda los días completos de las
 * estaciones que corresponden a los lugares con pronósticos guardados.
 */
export async function registrarObservaciones() {
  const lugares = Object.values(leer('pronosticos.json')).map((r) => r.lugar);
  if (!lugares.length) return { estaciones: 0 };

  const crudo = await bajarObservaciones();
  const guardadas = leer('observaciones.json');
  let nuevas = 0;
  for (const lugar of lugares) {
    const est = estacionCercana(crudo, lugar.lat, lugar.lon);
    if (!est) continue;
    const dias = observacionesPorDia(crudo, lugar.zona)[est.id] || {};
    const reg = guardadas[est.id] ||= { nombre: est.nombre, dias: {} };
    for (const [fecha, d] of Object.entries(dias)) {
      if (!reg.dias[fecha]) nuevas++;
      reg.dias[fecha] = { ...reg.dias[fecha], ...d };
    }
  }
  const limite = hace(GUARDAR_DIAS, new Date().toISOString().slice(0, 10));
  for (const r of Object.values(guardadas)) {
    for (const f of Object.keys(r.dias)) if (f < limite) delete r.dias[f];
  }
  escribir('observaciones.json', guardadas);
  return { estaciones: Object.keys(guardadas).length, diasNuevos: nuevas };
}

// ---------------------------------------------------------------------------
// Evaluación
// ---------------------------------------------------------------------------

/**
 * Compara emisiones con observaciones. Devuelve por fuente: cuántos días se
 * pudieron verificar, error medio de máxima y mínima (°C), error medio de
 * lluvia (mm) y en qué porcentaje de los días acertó si llovía o no.
 */
export function evaluar(emisiones, obsDias) {
  const acum = {};
  for (const [emitido, fuentes] of Object.entries(emisiones)) {
    for (const [id, dias] of Object.entries(fuentes)) {
      for (const d of dias) {
        const o = obsDias[d.fecha];
        const anticipacion = diasEntre(emitido, d.fecha);
        if (!o || anticipacion < 1 || anticipacion > 7) continue;
        const a = acum[id] ||= { fechas: new Set(), max: [], min: [], lluvia: [], acierto: [] };
        let usado = false;
        if (d.max != null && o.max != null) { a.max.push(Math.abs(d.max - o.max)); usado = true; }
        if (d.min != null && o.min != null) { a.min.push(Math.abs(d.min - o.min)); usado = true; }
        if (d.lluvia != null && o.lluvia != null) {
          a.lluvia.push(Math.abs(d.lluvia - o.lluvia));
          a.acierto.push((d.lluvia >= LLUVIA_MM) === (o.lluvia >= LLUVIA_MM) ? 1 : 0);
          usado = true;
        }
        if (usado) a.fechas.add(d.fecha);
      }
    }
  }
  const media = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 10) / 10 : null);
  const res = {};
  for (const [id, a] of Object.entries(acum)) {
    res[id] = {
      dias: a.fechas.size,
      comparaciones: a.max.length + a.min.length + a.lluvia.length,
      errorMax: media(a.max),
      errorMin: media(a.min),
      errorLluvia: media(a.lluvia),
      aciertoLluvia: a.acierto.length ? Math.round(media(a.acierto) * 100) : null,
    };
  }
  return res;
}

/**
 * Pesos por fuente según cuánto acierta: la inversa del error medio. Una
 * fuente con menos de 14 días verificados recibe el peso del medio, para no
 * premiarla ni castigarla por pocos datos. Si nadie llega a 14, no hay pesos.
 */
export function pesos(evaluacion, ids) {
  const calcular = (campoError) => {
    const conDatos = ids.filter((id) => (evaluacion[id]?.dias ?? 0) >= MIN_DIAS_PONDERAR && evaluacion[id][campoError] != null);
    if (!conDatos.length) return null;
    const p = Object.fromEntries(conDatos.map((id) => [id, 1 / (evaluacion[id][campoError] + 0.5)]));
    const valores = Object.values(p).sort((a, b) => a - b);
    const mediana = valores[Math.floor(valores.length / 2)];
    return Object.fromEntries(ids.map((id) => [id, p[id] ?? mediana]));
  };
  const temp = (() => {
    const conMax = calcular('errorMax'), conMin = calcular('errorMin');
    if (!conMax || !conMin) return conMax || conMin;
    return Object.fromEntries(ids.map((id) => [id, (conMax[id] + conMin[id]) / 2]));
  })();
  const lluvia = calcular('errorLluvia');
  return temp || lluvia ? { temp, lluvia } : null;
}

/** Todo lo que necesita la página para un lugar. */
export async function estadoVerificacion(lugar) {
  const reg = leer('pronosticos.json')[claveLugar(lugar)];
  let est = null;
  try {
    est = estacionCercana(await bajarObservaciones(), lugar.lat, lugar.lon);
  } catch {
    // Sin conexión con INUMET: se evalúa con lo guardado, sin nombre de estación.
  }
  const obs = est ? leer('observaciones.json')[est.id]?.dias || {} : {};
  const evaluacion = reg ? evaluar(reg.emisiones, obs) : {};
  return {
    estacion: est,
    emisiones: reg ? Object.keys(reg.emisiones).length : 0,
    evaluacion,
  };
}

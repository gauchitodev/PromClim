/**
 * Lo que mide la estación automática de INUMET más cercana, hora por hora:
 * cómo está ahora (temperatura, humedad, viento, presión) y cómo fue un día
 * ya terminado, para compararlo con lo que se había pronosticado.
 *
 * Trabaja sobre el JSON que publica INUMET (últimas 72 horas), el mismo que
 * usa la verificación.
 */
import { fechaLocal } from './util.js';

// INUMET dice "nudos" en el viento, pero los valores coinciden con los km/h de
// Open-Meteo para el mismo lugar y hora (en nudos serían el doble). Se toman
// como km/h.
const VARIABLES = {
  temp: 'TempAire',
  humedad: 'HumRelativa',
  rocio: 'TempPtoRocio',
  viento: 'IntViento',
  rafaga: 'IntVientMaxHora',
  direccion: 'DirViento',
  presion: 'PresAtmMar',
  lluvia: 'precipHoraria',
};

const PUNTOS = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];

/** De dónde viene el viento, en palabras ("del sureste"). */
export const direccionTexto = (grados) =>
  (Number.isFinite(grados) ? `del ${PUNTOS[Math.round(grados / 45) % 8]}` : null);

const hora = (fecha, zona) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', hour12: false }).format(fecha)) % 24;

/**
 * Las horas de una estación, de la más vieja a la más nueva:
 * [{ t: Date, temp, humedad, rocio, viento, rafaga, direccion, presion, lluvia }].
 */
export function serieEstacion(crudo, idEstacion) {
  const e = crudo.estaciones.findIndex((x) => x.id === idEstacion);
  if (e < 0) return [];
  const horas = crudo.fechas.map((f) => ({ t: new Date(f) }));
  for (const [campo, idStr] of Object.entries(VARIABLES)) {
    const serie = crudo.observaciones[crudo.variables.findIndex((v) => v.idStr === idStr)];
    for (const h of horas) h[campo] ??= null;
    if (!serie) continue;
    serie.iFechas.forEach((iF, j) => {
      const v = serie.datos[e]?.[j];
      const n = v === null || v === undefined || v === '' ? null : Number(v);
      if (horas[iF] && Number.isFinite(n)) horas[iF][campo] = n;
    });
  }
  return horas;
}

/**
 * Cómo está ahora: la última hora con temperatura, más la tendencia de la
 * presión en 3 horas (la que usan los meteorólogos) y la lluvia de 24 horas.
 */
export function ahora(serie) {
  const i = serie.findLastIndex((h) => h.temp !== null);
  if (i < 0) return null;
  const h = serie[i];

  let presion = null;
  const antes = serie[i - 3];
  if (h.presion !== null) {
    const cambio = antes?.presion != null ? Math.round((h.presion - antes.presion) * 10) / 10 : null;
    let tendencia = null;
    if (cambio !== null) {
      if (cambio <= -3) tendencia = 'bajando rápido';
      else if (cambio <= -1) tendencia = 'bajando';
      else if (cambio >= 3) tendencia = 'subiendo rápido';
      else if (cambio >= 1) tendencia = 'subiendo';
      else tendencia = 'estable';
    }
    presion = { hPa: Math.round(h.presion), cambio3h: cambio, tendencia };
  }

  const ultimas24 = serie.slice(Math.max(0, i - 23), i + 1).map((x) => x.lluvia).filter((x) => x !== null);
  return {
    hora: h.t.toISOString(),
    temp: h.temp,
    humedad: h.humedad,
    rocio: h.rocio,
    viento: h.viento,
    rafaga: h.rafaga,
    direccion: direccionTexto(h.direccion),
    presion,
    lluvia24: ultimas24.length >= 20 ? Math.round(ultimas24.reduce((s, x) => s + x, 0) * 10) / 10 : null,
  };
}

/**
 * Las 24 horas de un día (en la zona del lugar): [{ hora, temp, lluvia }], más
 * la ráfaga más fuerte. La lluvia de cada registro es la de la hora anterior,
 * así que va a esa hora.
 */
export function horasDelDia(serie, fecha, zona) {
  const horas = Array.from({ length: 24 }, (_, hh) => ({ hora: hh, temp: null, lluvia: null }));
  let rafaga = null;
  for (const h of serie) {
    if (h.temp !== null && fechaLocal(h.t, zona) === fecha) horas[hora(h.t, zona)].temp = h.temp;
    if (h.lluvia !== null) {
      const antes = new Date(h.t.getTime() - 3600e3);
      if (fechaLocal(antes, zona) === fecha) horas[hora(antes, zona)].lluvia = h.lluvia;
    }
    // La ráfaga también es de la hora anterior.
    if (h.rafaga !== null && fechaLocal(new Date(h.t.getTime() - 30 * 60e3), zona) === fecha) {
      rafaga = Math.max(rafaga ?? 0, h.rafaga);
    }
  }
  return { horas, rafaga };
}

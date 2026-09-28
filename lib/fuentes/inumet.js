/**
 * INUMET: no tiene API oficial. Su web se alimenta de un JSON con el
 * pronóstico de 7 días para 7 zonas del país (solo máxima y mínima en número;
 * el resto es texto). Usamos la zona más cercana al lugar elegido.
 */
import { pedirJSON, conCache, num } from '../util.js';

const URL = 'https://www.inumet.gub.uy/reportes/pronosticos/pronosticoV4.json';

// Centroides aproximados de las zonas de pronóstico
// (tomados de github.com/AnderKitty/clima-uy).
const ZONAS = [
  { id: 88, lat: -34.80, lon: -56.10 }, // Área Metropolitana
  { id: 89, lat: -34.95, lon: -54.95 }, // Punta del Este
  { id: 65, lat: -31.70, lon: -54.90 }, // Noreste
  { id: 66, lat: -31.50, lon: -57.20 }, // Noroeste
  { id: 67, lat: -33.40, lon: -56.20 }, // Centro-Sur
  { id: 68, lat: -33.60, lon: -54.30 }, // Este
  { id: 86, lat: -33.90, lon: -57.60 }, // Suroeste
];

function zonaMasCercana(lat, lon) {
  let mejor = null, mejorD = Infinity;
  for (const z of ZONAS) {
    const d = (z.lat - lat) ** 2 + ((z.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < mejorD) { mejorD = d; mejor = z.id; }
  }
  return mejor;
}

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default {
  id: 'inumet',
  nombre: 'INUMET',
  web: 'https://www.inumet.gub.uy/',

  aplica: (lugar) => lugar.pais
    ? lugar.pais === 'UY'
    : lugar.lat > -35.1 && lugar.lat < -30 && lugar.lon > -58.5 && lugar.lon < -53,
  motivoNoAplica: 'Solo cubre Uruguay',

  async obtener(lugar) {
    const datos = await conCache('inumet', 10 * 60e3, () => pedirJSON(URL));
    const zona = zonaMasCercana(lugar.lat, lugar.lon);
    const items = datos.items.filter((it) => it.zonaId === zona);
    if (!items.length) throw new Error('Zona sin datos');

    return {
      dias: items
        .sort((a, b) => a.diaMasN - b.diaMasN)
        .map((it) => ({
          fecha: sumarDias(datos.inicioPronostico, it.diaMasN),
          max: num(it.tempMax),
          min: num(it.tempMin),
          lluvia: null,
          prob: null,
          viento: null,
        })),
      nota: `Zona ${items[0].zonaLarga}`,
    };
  },
};

/**
 * Foreca: API oficial con clave (prueba de 30 días, 2000 consultas por día).
 * Ojo: las coordenadas van al revés, "lon,lat".
 */
import { pedirJSON, conCache, num, redondo } from '../util.js';

const BASE = 'https://weatherapi.foreca.net/api/v1';

export default {
  id: 'foreca',
  nombre: 'Foreca',
  web: 'https://www.foreca.com/',

  aplica: (lugar, config) => Boolean(config.foreca?.clave),
  motivoNoAplica: 'Falta la clave en config.local.json',

  obtener(lugar, config) {
    const coords = `${redondo(lugar.lon)},${redondo(lugar.lat)}`;
    return conCache(`foreca:${coords}`, 60 * 60e3, async () => {
      const r = await pedirJSON(
        `${BASE}/forecast/daily/${coords}?periods=10&windunit=KMH&dataset=full`,
        { headers: { Authorization: `Bearer ${config.foreca.clave}` } });

      return {
        dias: r.forecast.map((d) => ({
          fecha: d.date,
          max: num(d.maxTemp),
          min: num(d.minTemp),
          lluvia: num(d.precipAccum),
          prob: num(d.precipProb),
          viento: num(d.maxWindSpeed),
        })),
      };
    });
  },
};

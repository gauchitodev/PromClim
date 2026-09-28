/**
 * Visual Crossing: API con clave gratis (1000 registros por día), 15 días.
 */
import { pedirJSON, conCache, num, redondo } from '../util.js';

export default {
  id: 'visualcrossing',
  nombre: 'Visual Crossing',
  web: 'https://www.visualcrossing.com/',

  aplica: (lugar, config) => Boolean(config.visualcrossing?.clave),
  motivoNoAplica: 'Falta la clave en config.local.json',

  obtener(lugar, config) {
    const coords = `${redondo(lugar.lat)},${redondo(lugar.lon)}`;
    return conCache(`visualcrossing:${coords}`, 2 * 3600e3, async () => {
      const q = new URLSearchParams({
        unitGroup: 'metric', include: 'days', contentType: 'json',
        elements: 'datetime,tempmax,tempmin,precip,precipprob,windspeed',
        key: config.visualcrossing.clave,
      });
      const r = await pedirJSON(
        `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${coords}?${q}`);
      return {
        dias: r.days.slice(0, 10).map((d) => ({
          fecha: d.datetime,
          max: num(d.tempmax),
          min: num(d.tempmin),
          lluvia: num(d.precip),
          prob: num(d.precipprob),
          viento: num(d.windspeed),
        })),
      };
    });
  },
};

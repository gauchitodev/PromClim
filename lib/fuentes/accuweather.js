/**
 * AccuWeather: API oficial con clave (plan gratis: 50 consultas por día).
 * Cada lugar nuevo gasta 2 consultas (buscar la "location key" + pronóstico),
 * así que cacheamos fuerte: la key 30 días y el pronóstico 3 horas.
 */
import { pedirJSON, conCache, num, redondo } from '../util.js';

const BASE = 'https://dataservice.accuweather.com';

export default {
  id: 'accuweather',
  nombre: 'AccuWeather',
  web: 'https://www.accuweather.com/',

  aplica: (lugar, config) => Boolean(config.accuweather?.clave),
  motivoNoAplica: 'Falta la clave en config.local.json',

  async obtener(lugar, config) {
    const headers = { Authorization: `Bearer ${config.accuweather.clave}` };
    const coords = `${redondo(lugar.lat)},${redondo(lugar.lon)}`;

    const locKey = await conCache(`accu-key:${coords}`, 30 * 86_400e3, async () => {
      const r = await pedirJSON(
        `${BASE}/locations/v1/cities/geoposition/search?q=${coords}`, { headers });
      if (!r?.Key) throw new Error('No encontró el lugar');
      return r.Key;
    });

    return conCache(`accu:${locKey}`, 3 * 3600e3, async () => {
      const r = await pedirJSON(
        `${BASE}/forecasts/v1/daily/5day/${locKey}?metric=true&details=true&language=es`,
        { headers });

      return {
        dias: r.DailyForecasts.map((d) => {
          const lluvias = [d.Day?.TotalLiquid?.Value, d.Night?.TotalLiquid?.Value]
            .map(num).filter((x) => x !== null);
          const probs = [d.Day?.PrecipitationProbability, d.Night?.PrecipitationProbability]
            .map(num).filter((x) => x !== null);
          return {
            fecha: d.Date.slice(0, 10),
            max: num(d.Temperature?.Maximum?.Value),
            min: num(d.Temperature?.Minimum?.Value),
            lluvia: lluvias.length ? lluvias.reduce((s, x) => s + x, 0) : null,
            prob: probs.length ? Math.max(...probs) : null,
            viento: num(d.Day?.Wind?.Speed?.Value), // km/h con metric=true
          };
        }),
      };
    });
  },
};

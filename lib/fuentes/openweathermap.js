/**
 * OpenWeatherMap: API con clave gratis (plan Free, 5 días cada 3 horas).
 * Lo pasamos a días en la hora local del lugar.
 */
import { pedirJSON, conCache, num, redondo, agruparPorDia } from '../util.js';

export default {
  id: 'openweathermap',
  nombre: 'OpenWeatherMap',
  web: 'https://openweathermap.org/',

  aplica: (lugar, config) => Boolean(config.openweathermap?.clave),
  motivoNoAplica: 'Falta la clave en config.local.json',

  obtener(lugar, config) {
    const lat = redondo(lugar.lat), lon = redondo(lugar.lon);
    return conCache(`owm:${lat},${lon}`, 60 * 60e3, async () => {
      const q = new URLSearchParams({ lat, lon, units: 'metric', appid: config.openweathermap.clave });
      const r = await pedirJSON(`https://api.openweathermap.org/data/2.5/forecast?${q}`);
      const puntos = r.list.map((p) => ({
        t: new Date((p.dt + 1.5 * 3600) * 1000), horas: 3, // mitad del bloque
        temp: [num(p.main?.temp_max), num(p.main?.temp_min)],
        lluvia: num(p.rain?.['3h']) ?? 0,
        prob: p.pop === undefined ? null : Math.round(p.pop * 100),
        viento: num(p.wind?.speed) === null ? null : p.wind.speed * 3.6,
      }));
      return { dias: agruparPorDia(puntos, lugar.zona) };
    });
  },
};

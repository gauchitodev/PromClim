/**
 * WeatherAPI.com: API con clave gratis (el plan Free da 3 días).
 */
import { pedirJSON, conCache, num, redondo } from '../util.js';

export default {
  id: 'weatherapi',
  nombre: 'WeatherAPI',
  web: 'https://www.weatherapi.com/',

  aplica: (lugar, config) => Boolean(config.weatherapi?.clave),
  motivoNoAplica: 'Falta la clave en config.local.json',

  obtener(lugar, config) {
    const coords = `${redondo(lugar.lat)},${redondo(lugar.lon)}`;
    return conCache(`weatherapi:${coords}`, 60 * 60e3, async () => {
      const q = new URLSearchParams({ key: config.weatherapi.clave, q: coords, days: 10, aqi: 'no', alerts: 'no' });
      const r = await pedirJSON(`https://api.weatherapi.com/v1/forecast.json?${q}`);
      return {
        dias: r.forecast.forecastday.map((d) => ({
          fecha: d.date,
          max: num(d.day?.maxtemp_c),
          min: num(d.day?.mintemp_c),
          lluvia: num(d.day?.totalprecip_mm),
          prob: num(d.day?.daily_chance_of_rain),
          viento: num(d.day?.maxwind_kph),
        })),
      };
    });
  },
};

/**
 * Ensambles de Open-Meteo: cada modelo corre decenas de veces con
 * condiciones iniciales apenas distintas (143 escenarios en total entre
 * ECMWF, GFS, ICON y GEM). La probabilidad de lluvia es la parte de los
 * escenarios que da 1 mm o más ese día; la lluvia es el promedio.
 * Solo aporta lluvia y probabilidad: las temperaturas ya salen de Open-Meteo.
 */
import { pedirJSON, conCache, num, redondo } from '../util.js';

const MODELOS = 'ecmwf_ifs025,gfs025,icon_seamless,gem_global';
const UMBRAL_MM = 1;

export default {
  id: 'ensambles',
  nombre: 'Ensambles',
  web: 'https://open-meteo.com/en/docs/ensemble-api',

  aplica: () => true,

  obtener(lugar) {
    const lat = redondo(lugar.lat), lon = redondo(lugar.lon);
    return conCache(`ensambles:${lat},${lon}`, 60 * 60e3, async () => {
      const q = new URLSearchParams({
        latitude: lat, longitude: lon, daily: 'precipitation_sum',
        models: MODELOS, timezone: 'auto', forecast_days: 10,
      });
      const { daily } = await pedirJSON(`https://ensemble-api.open-meteo.com/v1/ensemble?${q}`, { timeout: 20_000 });
      // Cada clave precipitation_sum_* es un escenario (el control y los member01..NN).
      const escenarios = Object.keys(daily).filter((k) => k.startsWith('precipitation_sum'));

      let maxEscenarios = 0;
      const dias = daily.time.map((fecha, i) => {
        const v = escenarios.map((k) => num(daily[k][i])).filter((x) => x !== null);
        maxEscenarios = Math.max(maxEscenarios, v.length);
        return {
          fecha,
          max: null,
          min: null,
          lluvia: v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10 : null,
          prob: v.length ? Math.round(v.filter((x) => x >= UMBRAL_MM).length / v.length * 100) : null,
          viento: null,
        };
      });
      return { dias, nota: `${maxEscenarios} escenarios de 4 modelos` };
    });
  },
};

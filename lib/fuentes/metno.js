/**
 * MET Norway (yr.no): API pública y gratis, sin clave. Solo pide un
 * User-Agent que identifique la app. Global, basado en ECMWF fuera de Europa.
 * Viene por hora los primeros días y después cada 6 horas; lo pasamos a días.
 */
import { pedirJSON, conCache, num, agruparPorDia } from '../util.js';

const URL = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';

export default {
  id: 'metno',
  nombre: 'MET Norway',
  web: 'https://www.yr.no/',

  aplica: () => true,

  obtener(lugar) {
    // Sus condiciones piden no más de 4 decimales en las coordenadas.
    const lat = lugar.lat.toFixed(2), lon = lugar.lon.toFixed(2);
    return conCache(`metno:${lat},${lon}`, 60 * 60e3, async () => {
      const r = await pedirJSON(`${URL}?lat=${lat}&lon=${lon}`, {
        headers: { 'User-Agent': 'promclim/0.1 github.com/gauchitodev/PromClim' },
      });

      const puntos = [];
      for (const e of r.properties.timeseries) {
        const t = new Date(e.time);
        const ahora = e.data.instant.details;
        const viento = num(ahora.wind_speed);
        if (e.data.next_1_hours) {
          puntos.push({
            t, horas: 1,
            temp: num(ahora.air_temperature),
            lluvia: num(e.data.next_1_hours.details?.precipitation_amount),
            prob: num(e.data.next_1_hours.details?.probability_of_precipitation),
            viento: viento === null ? null : viento * 3.6,
          });
        } else if (e.data.next_6_hours) {
          const d = e.data.next_6_hours.details || {};
          puntos.push({
            t: new Date(t.getTime() + 3 * 3600e3), horas: 6, // mitad del período
            temp: [num(d.air_temperature_max), num(d.air_temperature_min)],
            lluvia: num(d.precipitation_amount),
            prob: num(d.probability_of_precipitation),
            viento: viento === null ? null : viento * 3.6,
          });
        }
      }
      return { dias: agruparPorDia(puntos, lugar.zona) };
    });
  },
};

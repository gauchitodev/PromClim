/**
 * Pronóstico hora por hora para el detalle de cada día. Sale de Open-Meteo
 * ("best match": el mejor modelo disponible para el lugar), no del promedio,
 * porque la mayoría de las fuentes solo dan datos por día.
 */
import { pedirJSON, conCache, num, redondo } from './util.js';

export function horario(lugar) {
  const lat = redondo(lugar.lat), lon = redondo(lugar.lon);
  return conCache(`horario:${lat},${lon}`, 30 * 60e3, async () => {
    const q = new URLSearchParams({
      latitude: lat, longitude: lon,
      hourly: 'temperature_2m,precipitation,precipitation_probability,wind_speed_10m',
      timezone: 'auto', forecast_days: 10,
    });
    const { hourly: h } = await pedirJSON(`https://api.open-meteo.com/v1/forecast?${q}`);

    // { "2026-09-28": [{ hora: 0, temp, lluvia, prob, viento }, ...], ... }
    const porDia = {};
    h.time.forEach((t, i) => {
      const fecha = t.slice(0, 10);
      (porDia[fecha] ||= []).push({
        hora: Number(t.slice(11, 13)),
        temp: num(h.temperature_2m[i]),
        lluvia: num(h.precipitation[i]),
        prob: num(h.precipitation_probability[i]),
        viento: num(h.wind_speed_10m[i]),
      });
    });
    return porDia;
  });
}

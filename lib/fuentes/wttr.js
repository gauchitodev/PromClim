/**
 * wttr.in: gratis y sin clave. Los datos son de World Weather Online.
 * Solo 3 días, en bloques de 3 horas.
 */
import { pedirJSON, conCache, num, redondo } from '../util.js';

export default {
  id: 'wttr',
  nombre: 'wttr.in',
  web: 'https://wttr.in/',

  aplica: () => true,

  obtener(lugar) {
    const lat = redondo(lugar.lat), lon = redondo(lugar.lon);
    return conCache(`wttr:${lat},${lon}`, 60 * 60e3, async () => {
      const r = await pedirJSON(`https://wttr.in/${lat},${lon}?format=j1`, { timeout: 20_000 });
      return {
        dias: r.weather.map((d) => {
          const horas = d.hourly || [];
          const lluvias = horas.map((h) => num(h.precipMM)).filter((x) => x !== null);
          const probs = horas.map((h) => num(h.chanceofrain)).filter((x) => x !== null);
          const vientos = horas.map((h) => num(h.windspeedKmph)).filter((x) => x !== null);
          return {
            fecha: d.date,
            max: num(d.maxtempC),
            min: num(d.mintempC),
            lluvia: lluvias.length ? Math.round(lluvias.reduce((s, x) => s + x, 0) * 10) / 10 : null,
            prob: probs.length ? Math.max(...probs) : null,
            viento: vientos.length ? Math.max(...vientos) : null,
          };
        }),
      };
    });
  },
};

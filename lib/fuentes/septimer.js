/**
 * 7Timer!: servicio gratis sin clave, basado en el modelo GFS.
 * El producto "civillight" da máxima y mínima por día (el viento viene en
 * una escala propia y la lluvia sin milímetros, así que no los usamos).
 */
import { pedirJSON, conCache, num, redondo } from '../util.js';

export default {
  id: '7timer',
  nombre: '7Timer!',
  web: 'https://www.7timer.info/',

  aplica: () => true,

  obtener(lugar) {
    const lat = redondo(lugar.lat), lon = redondo(lugar.lon);
    return conCache(`7timer:${lat},${lon}`, 2 * 3600e3, async () => {
      const r = await pedirJSON(
        `https://www.7timer.info/bin/civillight.php?lon=${lon}&lat=${lat}&output=json`,
        { timeout: 20_000 });
      return {
        dias: r.dataseries.map((d) => {
          const f = String(d.date);
          return {
            fecha: `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`,
            max: num(d.temp2m?.max),
            min: num(d.temp2m?.min),
            lluvia: null,
            prob: null,
            viento: null,
          };
        }),
      };
    });
  },
};

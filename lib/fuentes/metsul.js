/**
 * MetSul: sin API pública. El buscador de metsul.com/previsao-do-tempo pide
 * un JSON de 10 días por nombre + coordenadas. Cubre el sur de Sudamérica;
 * para otros lugares contesta {"error": "Dados Indisponíveis"}.
 */
import { pedirJSON, conCache, num, redondo } from '../util.js';

const BASE = 'https://dados.metsul.com/api/v1/previsao/10dias/quadro_novo';

export default {
  id: 'metsul',
  nombre: 'MetSul',
  web: 'https://metsul.com/previsao-do-tempo/',

  aplica: () => true,

  obtener(lugar) {
    const lat = redondo(lugar.lat), lon = redondo(lugar.lon);
    return conCache(`metsul:${lat},${lon}`, 60 * 60e3, async () => {
      const url = `${BASE}/${encodeURIComponent(lugar.nombre || 'local')}/${lat}/${lon}/`;
      const r = await pedirJSON(url, { headers: { Referer: 'https://metsul.com/' } });
      if (r.error || !Array.isArray(r.dados)) throw new Error('Sin datos para este lugar');

      return {
        dias: r.dados.map((d) => ({
          fecha: `${d.ano}-${d.mes}-${d.dia}`,
          max: num(d.maxima),
          min: num(d.minima),
          lluvia: num(d.prec),
          prob: null,
          viento: num(d.vento), // km/h
        })),
      };
    });
  },
};

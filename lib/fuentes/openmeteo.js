/**
 * Open-Meteo: gratis y sin clave. Trae varios modelos globales a la vez;
 * los promediamos entre sí y cuentan como UNA fuente en el promedio general,
 * para que no le ganen por cantidad a las demás.
 */
import { pedirJSON, conCache, num, redondo } from '../util.js';
import { promediarListas } from '../promedio.js';

const MODELOS = {
  ecmwf_ifs025: 'ECMWF',
  gfs_seamless: 'GFS',
  icon_seamless: 'ICON',
  gem_seamless: 'GEM',
  meteofrance_seamless: 'Météo-France',
  ukmo_seamless: 'UKMO',
  jma_seamless: 'JMA',
  cma_grapes_global: 'CMA (China)',
  ecmwf_aifs025_single: 'ECMWF AIFS (IA)',
};

const VARIABLES = {
  max: 'temperature_2m_max',
  min: 'temperature_2m_min',
  lluvia: 'precipitation_sum',
  prob: 'precipitation_probability_max',
  viento: 'wind_speed_10m_max',
};

export default {
  id: 'openmeteo',
  nombre: 'Open-Meteo',
  web: 'https://open-meteo.com/',

  aplica: () => true,

  obtener(lugar) {
    const clave = `openmeteo:${redondo(lugar.lat)},${redondo(lugar.lon)}`;
    return conCache(clave, 30 * 60e3, async () => {
      const q = new URLSearchParams({
        latitude: lugar.lat,
        longitude: lugar.lon,
        daily: Object.values(VARIABLES).join(','),
        models: Object.keys(MODELOS).join(','),
        timezone: 'auto',
        forecast_days: 10,
      });
      const { daily } = await pedirJSON(`https://api.open-meteo.com/v1/forecast?${q}`);

      const modelos = {};
      for (const [id, nombre] of Object.entries(MODELOS)) {
        const dias = daily.time.map((fecha, i) => {
          const dia = { fecha };
          for (const [campo, variable] of Object.entries(VARIABLES)) {
            dia[campo] = num(daily[`${variable}_${id}`]?.[i]);
          }
          // Algún modelo devuelve -0.1 mm por redondeo.
          if (dia.lluvia !== null) dia.lluvia = Math.max(0, dia.lluvia);
          return dia;
        });
        // Modelos de corto alcance (UKMO, Météo-France) vienen con null al final.
        const conDatos = dias.filter((d) => d.max !== null || d.min !== null);
        if (conDatos.length) modelos[nombre] = conDatos;
      }

      return {
        dias: promediarListas(Object.values(modelos)),
        modelos,
        nota: `Promedio de ${Object.keys(modelos).length} modelos`,
      };
    });
  },
};

/**
 * PromClim — servidor. Sin dependencias: Node >= 18.
 *
 *   GET /api/buscar?q=Trinidad            → lugares (geocoding de Open-Meteo)
 *   GET /api/pronostico?lat=&lon=&nombre=&pais=&zona=
 *                                          → cada fuente + el promedio
 *   GET /*                                 → archivos de public/
 */
import http from 'node:http';
import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pedirJSON, conCache } from './lib/util.js';
import { promedioGeneral } from './lib/promedio.js';
import openmeteo from './lib/fuentes/openmeteo.js';
import inumet from './lib/fuentes/inumet.js';
import metsul from './lib/fuentes/metsul.js';
import accuweather from './lib/fuentes/accuweather.js';
import foreca from './lib/fuentes/foreca.js';

// Con el hotspot a veces IPv6 no sale y los pedidos se cuelgan 10 s.
dns.setDefaultResultOrder('ipv4first');

const FUENTES = [openmeteo, accuweather, foreca, metsul, inumet];

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, 'public');

// config.local.json no se sube a git: ahí van las claves de las APIs.
const archivoConfig = path.join(RAIZ, 'config.local.json');
const config = existsSync(archivoConfig) ? JSON.parse(readFileSync(archivoConfig, 'utf8')) : {};
const PUERTO = Number(process.env.PORT) || config.puerto || 8080;
const HOST = process.env.HOST || config.host || '127.0.0.1';

// ---------------------------------------------------------------------------

const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * El geocoding de Open-Meteo busca solo por nombre del lugar, así que
 * "Trinidad Flores" o "Trinidad, Uruguay" no dan nada. Probamos con las
 * primeras palabras como nombre y usamos el resto para filtrar por
 * departamento/provincia/país.
 */
async function buscar(q) {
  const palabras = q.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (palabras.join(' ').length < 2) return [];
  return conCache(`buscar:${sinTildes(palabras.join(' '))}`, 86_400e3, async () => {
    const minimo = Math.max(1, palabras.length - 3);
    for (let k = palabras.length; k >= minimo; k--) {
      const nombre = palabras.slice(0, k).join(' ');
      const filtros = palabras.slice(k).map(sinTildes);
      const p = new URLSearchParams({ name: nombre, count: filtros.length ? 50 : 10, language: 'es', format: 'json' });
      const r = await pedirJSON(`https://geocoding-api.open-meteo.com/v1/search?${p}`);
      const lugares = (r.results || []).filter((l) => {
        const donde = sinTildes([l.admin1, l.admin2, l.country, l.country_code].filter(Boolean).join(' '));
        return filtros.every((f) => donde.includes(f));
      });
      if (lugares.length) {
        return lugares.slice(0, 10).map((l) => ({
          nombre: l.name,
          detalle: [l.admin1, l.country].filter(Boolean).join(', '),
          lat: l.latitude,
          lon: l.longitude,
          pais: l.country_code,
          zona: l.timezone,
        }));
      }
    }
    return [];
  });
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del lugar. */
function hoyEn(zona) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function pronostico(lugar) {
  const fuentes = await Promise.all(FUENTES.map(async (f) => {
    const base = { id: f.id, nombre: f.nombre, web: f.web };
    if (!f.aplica(lugar, config)) return { ...base, estado: 'omitida', motivo: f.motivoNoAplica };
    try {
      return { ...base, estado: 'ok', ...(await f.obtener(lugar, config)) };
    } catch (e) {
      console.warn(`[${f.id}]`, e.message);
      return { ...base, estado: 'error', motivo: e.name === 'TimeoutError' ? 'No respondió a tiempo' : e.message };
    }
  }));

  const ok = fuentes.filter((f) => f.estado === 'ok');
  return {
    lugar,
    generado: new Date().toISOString(),
    promedio: promedioGeneral(ok.map((f) => f.dias), hoyEn(lugar.zona)),
    fuentes,
  };
}

// ---------------------------------------------------------------------------

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function responderJSON(res, codigo, datos) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

async function servirArchivo(res, ruta) {
  const archivo = path.normalize(path.join(PUBLICO, ruta === '/' ? 'index.html' : ruta));
  if (!archivo.startsWith(PUBLICO + path.sep)) return responderJSON(res, 403, { error: 'Prohibido' });
  try {
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    res.end(cuerpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/buscar') {
      return responderJSON(res, 200, await buscar(url.searchParams.get('q') || ''));
    }
    if (url.pathname === '/api/pronostico') {
      const p = url.searchParams;
      const lat = Number(p.get('lat')), lon = Number(p.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return responderJSON(res, 400, { error: 'Coordenadas inválidas' });
      }
      return responderJSON(res, 200, await pronostico({
        lat, lon,
        nombre: (p.get('nombre') || '').slice(0, 80),
        pais: (p.get('pais') || '').toUpperCase().slice(0, 2) || null,
        zona: p.get('zona') || 'UTC',
      }));
    }
    if (req.method !== 'GET') return responderJSON(res, 405, { error: 'Método no permitido' });
    return servirArchivo(res, decodeURIComponent(url.pathname));
  } catch (e) {
    console.error(e);
    return responderJSON(res, 502, { error: e.message });
  }
});

servidor.listen(PUERTO, HOST, () => {
  const conClave = FUENTES.filter((f) => f.aplica({ lat: 0, lon: 0, pais: 'UY' }, config)).map((f) => f.nombre);
  console.log(`PromClim en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PUERTO}`);
  console.log(`Fuentes activas: ${conClave.join(', ')}`);
});

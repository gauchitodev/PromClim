/**
 * PromClim — servidor. Sin dependencias: Node >= 20.
 *
 *   GET /api/buscar?q=Trinidad            → lugares (geocoding de Open-Meteo)
 *   GET /api/pronostico?lat=&lon=&nombre=&detalle=&pais=&zona=
 *                                          → cada fuente + el promedio, y en
 *                                            Uruguay la estación de INUMET
 *                                            (ahora y cómo fue ayer)
 *   GET /api/analisis?(lo mismo)           → análisis con IA (Ollama), en texto
 *                                            que va llegando de a pedazos
 *   GET /api/resumen                       → próximos 3 días del último lugar (widgets)
 *   GET /api/registrar                     → guarda pronóstico y observaciones
 *                                            (lo llama el temporizador de systemd)
 *   GET /*                                 → archivos de public/
 */
import http from 'node:http';
import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pedirJSON, conCache } from './lib/util.js';
import { promedioGeneral, acumulados, comoFuente } from './lib/promedio.js';
import {
  estadoVerificacion, pesos, registrarObservaciones, registrarPronostico,
  MIN_DIAS_PONDERAR, PROMEDIO_PONDERADO, PROMEDIO_SIMPLE,
} from './lib/verificacion.js';
import { analizar } from './lib/ia.js';
import { estacionYAyer } from './lib/ayer.js';
import { horario } from './lib/horario.js';
import openmeteo from './lib/fuentes/openmeteo.js';
import inumet from './lib/fuentes/inumet.js';
import metsul from './lib/fuentes/metsul.js';
import accuweather from './lib/fuentes/accuweather.js';
import foreca from './lib/fuentes/foreca.js';
import ensambles from './lib/fuentes/ensambles.js';
import metno from './lib/fuentes/metno.js';
import septimer from './lib/fuentes/septimer.js';
import wttr from './lib/fuentes/wttr.js';
import openweathermap from './lib/fuentes/openweathermap.js';
import weatherapi from './lib/fuentes/weatherapi.js';
import visualcrossing from './lib/fuentes/visualcrossing.js';

// Con el hotspot a veces IPv6 no sale y los pedidos se cuelgan 10 s.
dns.setDefaultResultOrder('ipv4first');

const FUENTES = [
  // Sin clave
  openmeteo, ensambles, metno, metsul, inumet, wttr, septimer,
  // Con clave (gratis) en config.local.json
  accuweather, foreca, openweathermap, weatherapi, visualcrossing,
];

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, 'public');

const [MAYOR] = process.versions.node.split('.').map(Number);
if (MAYOR < 20) {
  console.error(`PromClim necesita Node 20 o más nuevo (tenés ${process.versions.node}).`);
  process.exit(1);
}

// config.local.json no se sube a git: ahí van las claves de las APIs.
function leerConfig() {
  const archivo = path.join(RAIZ, 'config.local.json');
  if (!existsSync(archivo)) return {};
  try {
    const c = JSON.parse(readFileSync(archivo, 'utf8'));
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('tiene que ser un objeto { ... }');
    return c;
  } catch (e) {
    console.error(`config.local.json está mal escrito: ${e.message}`);
    process.exit(1);
  }
}
const config = leerConfig();
// 8741 y no 8080: el 8080 lo usan por defecto muchísimos programas.
const PUERTO = Number(process.env.PORT) || config.puerto || 8741;
const HOST = process.env.HOST || config.host || '127.0.0.1';

// Arranque bajo demanda: systemd (promclim.socket) escucha el puerto y, al
// primer pedido, arranca PromClim y le pasa el socket ya abierto (fd 3).
const DE_SYSTEMD = process.env.LISTEN_FDS === '1' && Number(process.env.LISTEN_PID) === process.pid;
// En ese modo se apaga solo después de un rato sin uso; systemd lo vuelve a
// prender en el próximo pedido.
const APAGAR_SIN_USO_MIN = Number(config.apagarSinUsoMin) || 20;

// ---------------------------------------------------------------------------

const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * El geocoding de Open-Meteo busca solo por nombre del lugar, así que
 * "Trinidad Flores" o "Trinidad, Uruguay" no dan nada. Probamos con las
 * primeras palabras como nombre y usamos el resto para filtrar por
 * departamento/provincia/país.
 */
async function buscar(q) {
  const palabras = q.slice(0, 100).replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
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
  // El hora por hora es un extra para el detalle: si falla, la página sigue sin él.
  const pedidoHorario = horario(lugar).catch((e) => {
    console.warn('[horario]', e.message);
    return null;
  });

  // La verificación baja las observaciones de INUMET: va en paralelo con las fuentes.
  const enUruguay = inumet.aplica(lugar, config);
  const pedidoVerificacion = enUruguay ? estadoVerificacion(lugar) : null;
  pedidoVerificacion?.catch(() => {});
  // Cómo está ahora en la estación y cómo le fue al pronóstico ayer.
  const nombres = Object.fromEntries(FUENTES.map((f) => [f.id, f.nombre]));
  const pedidoEstacion = enUruguay
    ? estacionYAyer(lugar, nombres).catch((e) => {
      console.warn('[estación]', e.message);
      return null;
    })
    : null;

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
  const hoy = hoyEn(lugar.zona);
  const simple = promedioGeneral(ok.map((f) => f.dias), hoy);

  // Verificación contra las estaciones de INUMET (solo Uruguay): si ya hay
  // días suficientes, el promedio pesa más a las fuentes que más aciertan acá.
  let verificacion = null;
  let promedio = simple;
  if (enUruguay) {
    try {
      verificacion = await pedidoVerificacion;
      const p = config.ponderar === false ? null : pesos(verificacion.evaluacion, ok.map((f) => f.id));
      if (p) {
        promedio = promedioGeneral(ok.map((f) => f.dias), hoy, ok.map((f) => ({ temp: p.temp?.[f.id], lluvia: p.lluvia?.[f.id] })));
        verificacion.pesos = Object.fromEntries(ok.map((f) => [f.id, {
          temp: p.temp ? Math.round(p.temp[f.id] * 100) / 100 : null,
          lluvia: p.lluvia ? Math.round(p.lluvia[f.id] * 100) / 100 : null,
        }]));
      }
      verificacion.ponderado = Boolean(p);
      verificacion.minDias = MIN_DIAS_PONDERAR;
      registrarPronostico(lugar, fuentes, {
        [PROMEDIO_SIMPLE]: comoFuente(simple),
        [PROMEDIO_PONDERADO]: p ? comoFuente(promedio) : null,
      });
      // Las observaciones se guardan también al usar la app (además del
      // temporizador), como mucho cada 6 horas.
      conCache('registrar-obs', 6 * 3600e3, registrarObservaciones).catch((e) => console.warn('[verificación]', e.message));
    } catch (e) {
      console.warn('[verificación]', e.message);
    }
  }

  return {
    lugar,
    generado: new Date().toISOString(),
    promedio,
    acumulados: acumulados(ok, promedio),
    fuentes,
    horario: await pedidoHorario,
    verificacion,
    estacion: await pedidoEstacion,
  };
}

/** Lo que corre el temporizador: pronóstico del último lugar y observaciones. */
async function registrar() {
  const lugar = leerUltimoLugar();
  if (lugar) await pronostico(lugar);
  return { lugar: lugar?.nombre ?? null, ...(await registrarObservaciones()) };
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Último lugar elegido en la página. Lo usa /api/resumen (el widget del
// escritorio), que no tiene cómo saber qué buscaste en el navegador.
// ---------------------------------------------------------------------------

const ARCHIVO_ULTIMO = path.join(RAIZ, 'ultimo-lugar.local.json');

function leerUltimoLugar() {
  try {
    const l = JSON.parse(readFileSync(ARCHIVO_ULTIMO, 'utf8'));
    const p = new URLSearchParams(Object.entries(l).map(([k, v]) => [k, String(v ?? '')]));
    return leerLugar(p);
  } catch {
    return null;
  }
}

function guardarUltimoLugar(lugar) {
  const previo = leerUltimoLugar();
  if (previo && previo.lat === lugar.lat && previo.lon === lugar.lon && previo.nombre === lugar.nombre) return;
  try {
    writeFileSync(ARCHIVO_ULTIMO, JSON.stringify(lugar, null, 2) + '\n');
  } catch (e) {
    console.warn('No pude guardar el último lugar:', e.message);
  }
}

/** Lo justo para un widget: el lugar y los próximos 3 días promediados. */
async function resumen() {
  const lugar = leerUltimoLugar();
  if (!lugar) return { sinLugar: true };
  const datos = await pronostico(lugar);
  const ok = datos.fuentes.filter((f) => f.estado === 'ok');
  const r = (c) => (c ? Math.round(c.prom * 10) / 10 : null);
  return {
    lugar: { nombre: lugar.nombre, detalle: lugar.detalle },
    generado: datos.generado,
    fuentes: { ok: ok.length, total: datos.fuentes.filter((f) => f.estado !== 'omitida').length },
    acumulado7: datos.acumulados.promedio.d7,
    dias: datos.promedio.slice(0, 3).map((d) => ({
      fecha: d.fecha,
      max: r(d.max), min: r(d.min), lluvia: r(d.lluvia), prob: r(d.prob),
      llueve: d.llueve,
    })),
  };
}

// ---------------------------------------------------------------------------
// Seguridad
//
// PromClim corre en la propia compu y no tiene usuarios ni contraseña. Estas
// defensas son para que nadie más lo use por atrás, gastando las claves de las
// APIs o el procesador con la IA: ni otra página abierta en el navegador, ni
// (salvo que se configure) otra compu de la red.
// ---------------------------------------------------------------------------

const ES_LOCAL = ['127.0.0.1', 'localhost', '::1'].includes(HOST);

// Nombres con los que se puede llamar al servidor (cabecera Host). Frena el
// "DNS rebinding": una página maliciosa que hace apuntar su dominio a
// 127.0.0.1 para hablarle a PromClim como si fuera ella misma.
const HOSTS_PERMITIDOS = new Set([
  `localhost:${PUERTO}`, `127.0.0.1:${PUERTO}`, `[::1]:${PUERTO}`,
  ...(Array.isArray(config.hostsPermitidos) ? config.hostsPermitidos : []).map((h) => String(h).toLowerCase()),
]);

/** Las /api solo contestan a la propia página, no a otras abiertas en el navegador. */
function pedidoPropio(req) {
  const sitio = req.headers['sec-fetch-site'];
  if (sitio && sitio !== 'same-origin' && sitio !== 'none') return false;
  const origen = req.headers.origin;
  if (origen && origen !== `http://${req.headers.host}`) return false;
  return true;
}

const CABECERAS = {
  // La página solo carga cosas de PromClim mismo: nada de scripts, estilos ni
  // fuentes de afuera, y no se puede meter adentro de otra página.
  'Content-Security-Policy': [
    "default-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'",
    "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// ---------------------------------------------------------------------------

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function responderJSON(res, codigo, datos) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

function responderTexto(res, codigo, texto) {
  res.writeHead(codigo, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(texto);
}

async function servirArchivo(res, ruta) {
  let decodificada;
  try {
    decodificada = decodeURIComponent(ruta);
  } catch {
    return responderTexto(res, 400, 'Ruta inválida');
  }
  if (decodificada.includes('\0')) return responderTexto(res, 400, 'Ruta inválida');
  const archivo = path.normalize(path.join(PUBLICO, decodificada === '/' ? 'index.html' : decodificada));
  // Nada fuera de public/, ni archivos ocultos.
  if (!archivo.startsWith(PUBLICO + path.sep) || path.basename(archivo).startsWith('.')) {
    return responderTexto(res, 404, 'No encontrado');
  }
  const tipo = TIPOS[path.extname(archivo)];
  if (!tipo) return responderTexto(res, 404, 'No encontrado');
  try {
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-cache' });
    res.end(cuerpo);
  } catch {
    responderTexto(res, 404, 'No encontrado');
  }
}

/** Zona horaria válida para Intl, o UTC. */
function zonaValida(z) {
  if (!z || z.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return z;
  } catch {
    return 'UTC';
  }
}

function leerLugar(p) {
  const lat = Number(p.get('lat')), lon = Number(p.get('lon'));
  if (!p.get('lat') || !p.get('lon') || !Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const pais = (p.get('pais') || '').toUpperCase();
  return {
    lat, lon,
    nombre: (p.get('nombre') || '').slice(0, 80),
    detalle: (p.get('detalle') || '').slice(0, 120),
    pais: /^[A-Z]{2}$/.test(pais) ? pais : null,
    zona: zonaValida(p.get('zona')),
  };
}

// El análisis tarda: se guarda 30 min por lugar para no repetirlo al recargar.
const analisisHechos = new Map();
// La IA usa todo el procesador: un análisis por vez.
let analisisEnCurso = false;

async function responderAnalisis(req, res, datos) {
  if (!datos.promedio.length) return responderJSON(res, 422, { error: 'No hay datos para analizar' });
  const clave = `${datos.lugar.lat.toFixed(2)},${datos.lugar.lon.toFixed(2)}`;
  const previo = analisisHechos.get(clave);
  const cabecera = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
  if (previo && Date.now() - previo.t < 30 * 60e3) {
    res.writeHead(200, cabecera);
    return res.end(previo.texto);
  }
  if (analisisEnCurso) {
    return responderJSON(res, 429, { error: 'Ya hay un análisis en curso. Esperá a que termine.', codigo: 'ocupado' });
  }

  // Si se cierra la página a mitad de camino, se corta la IA.
  const cancelar = new AbortController();
  res.on('close', () => { if (!res.writableFinished) cancelar.abort(); });

  analisisEnCurso = true;
  let texto = '';
  try {
    await analizar(datos, config, (pedazo) => {
      if (!res.headersSent) res.writeHead(200, cabecera);
      texto += pedazo;
      res.write(pedazo);
    }, cancelar.signal);
  } catch (e) {
    if (cancelar.signal.aborted) return res.end();
    const mensaje = e.name === 'TimeoutError' ? 'La IA tardó demasiado' : e.message;
    if (res.headersSent) return res.end(`\n\n[Se cortó el análisis: ${mensaje}]`);
    return responderJSON(res, 503, { error: mensaje, codigo: e.codigo || 'ia', modelo: e.modelo });
  } finally {
    analisisEnCurso = false;
  }
  if (!res.headersSent) res.writeHead(200, cabecera);
  if (texto) {
    analisisHechos.set(clave, { t: Date.now(), texto });
    if (analisisHechos.size > 100) analisisHechos.delete(analisisHechos.keys().next().value);
  }
  res.end();
}

let ultimoUso = Date.now();

const servidor = http.createServer(async (req, res) => {
  ultimoUso = Date.now();
  for (const [k, v] of Object.entries(CABECERAS)) res.setHeader(k, v);

  if (!HOSTS_PERMITIDOS.has((req.headers.host || '').toLowerCase())) {
    return responderTexto(res, 421, 'Host no permitido. Si entrás desde otra compu, agregalo a "hostsPermitidos" en config.local.json.');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return responderTexto(res, 405, 'Método no permitido');
  }

  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    return responderTexto(res, 400, 'Pedido inválido');
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      if (!pedidoPropio(req)) return responderJSON(res, 403, { error: 'Solo la página de PromClim puede usar la API' });

      if (url.pathname === '/api/registrar') {
        return responderJSON(res, 200, await registrar());
      }
      if (url.pathname === '/api/resumen') {
        return responderJSON(res, 200, await resumen());
      }
      if (url.pathname === '/api/buscar') {
        return responderJSON(res, 200, await buscar(url.searchParams.get('q') || ''));
      }
      if (url.pathname === '/api/pronostico' || url.pathname === '/api/analisis') {
        const lugar = leerLugar(url.searchParams);
        if (!lugar) return responderJSON(res, 400, { error: 'Coordenadas inválidas' });
        const datos = await pronostico(lugar);
        if (url.pathname === '/api/pronostico') {
          guardarUltimoLugar(lugar);
          return responderJSON(res, 200, datos);
        }
        return responderAnalisis(req, res, datos);
      }
      return responderJSON(res, 404, { error: 'No existe' });
    }
    return servirArchivo(res, url.pathname);
  } catch (e) {
    // El detalle va a la consola, no a la página.
    console.error(e);
    if (res.headersSent) return res.end();
    return responderJSON(res, 500, { error: 'Error interno. Mirá la consola donde corre PromClim.' });
  }
});

if (DE_SYSTEMD) {
  // Revisa cada minuto; no se apaga en medio de un análisis de la IA.
  setInterval(() => {
    if (!analisisEnCurso && Date.now() - ultimoUso > APAGAR_SIN_USO_MIN * 60e3) {
      console.log(`Sin uso hace ${APAGAR_SIN_USO_MIN} min: me apago (systemd me prende de nuevo si hace falta).`);
      process.exit(0);
    }
  }, 60e3).unref();
}

servidor.listen(DE_SYSTEMD ? { fd: 3 } : { port: PUERTO, host: HOST }, () => {
  const activas = FUENTES.filter((f) => f.aplica({ lat: 0, lon: 0, pais: 'UY' }, config)).map((f) => f.nombre);
  console.log(`PromClim en http://${ES_LOCAL ? 'localhost' : HOST}:${PUERTO}`);
  console.log(`Fuentes activas: ${activas.join(', ')}`);
  if (!ES_LOCAL) {
    console.warn([
      '',
      `OJO: PromClim está escuchando en ${HOST}, así que otras compus de la red pueden llegar.`,
      'No tiene usuario ni contraseña: quien entre usa tus claves de las APIs y tu IA.',
      'Solo va a contestar a los nombres de "hostsPermitidos" en config.local.json.',
    ].join('\n'));
  }
});

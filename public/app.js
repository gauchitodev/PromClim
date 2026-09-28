const $ = (id) => document.getElementById(id);
const input = $('buscar');
const lista = $('resultados');

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const fecha = (iso) => new Date(`${iso}T12:00:00`);
const grados = (v) => (v === null || v === undefined ? '–' : `${Math.round(v)}°`);

function el(tag, attrs = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...hijos.flat().filter((h) => h !== null && h !== undefined && h !== false));
  return e;
}
const icono = (nombre) => el('span', { class: 'icono', 'aria-hidden': 'true' }, nombre);

// Guardar el último lugar. localStorage puede no estar disponible (modo privado).
const recordar = {
  leer() { try { return JSON.parse(localStorage.getItem('lugar')); } catch { return null; } },
  guardar(l) { try { localStorage.setItem('lugar', JSON.stringify(l)); } catch {} },
};

// ---------------------------------------------------------------------------
// Buscador
// ---------------------------------------------------------------------------

let resultados = [];
let marcado = -1;
let espera;
let ultimaBusqueda = 0;

input.addEventListener('input', () => {
  clearTimeout(espera);
  const q = input.value.trim();
  if (q.length < 2) return cerrarLista();
  espera = setTimeout(() => buscar(q), 250);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!resultados.length) return;
    e.preventDefault();
    marcado = (marcado + (e.key === 'ArrowDown' ? 1 : -1) + resultados.length) % resultados.length;
    pintarLista();
  } else if (e.key === 'Enter') {
    if (resultados.length) elegir(resultados[Math.max(marcado, 0)]);
  } else if (e.key === 'Escape') {
    cerrarLista();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.buscador')) cerrarLista();
});

async function buscar(q) {
  const n = ++ultimaBusqueda;
  try {
    const r = await fetch(`/api/buscar?q=${encodeURIComponent(q)}`);
    const datos = await r.json();
    if (n !== ultimaBusqueda) return; // llegó tarde, ya hay otra búsqueda
    resultados = Array.isArray(datos) ? datos : [];
    marcado = -1;
    pintarLista();
  } catch {
    resultados = [];
    pintarLista('No se pudo buscar. ¿Hay internet?');
  }
}

function pintarLista(mensaje) {
  lista.replaceChildren(
    ...(resultados.length
      ? resultados.map((l, i) => el('li', {
          role: 'option',
          'aria-selected': String(i === marcado),
          onclick: () => elegir(l),
        }, icono('location_on'), el('div', {}, l.nombre, el('small', {}, l.detalle))))
      : [el('li', { class: 'nada' }, mensaje || 'No encontré ese lugar')]),
  );
  lista.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function cerrarLista() {
  lista.hidden = true;
  input.setAttribute('aria-expanded', 'false');
}

function elegir(lugar) {
  cerrarLista();
  input.value = '';
  input.blur();
  recordar.guardar(lugar);
  cargar(lugar);
}

$('ubicacion').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => elegir({
      nombre: 'Mi ubicación',
      detalle: `${p.coords.latitude.toFixed(2)}, ${p.coords.longitude.toFixed(2)}`,
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      pais: null,
      zona: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    () => alert('No pude obtener tu ubicación.'),
  );
});

// ---------------------------------------------------------------------------
// Pronóstico
// ---------------------------------------------------------------------------

async function cargar(lugar) {
  $('vacio').hidden = true;
  $('contenido').hidden = true;
  $('cargando').hidden = false;
  const q = new URLSearchParams({
    lat: lugar.lat, lon: lugar.lon, nombre: lugar.nombre,
    pais: lugar.pais || '', zona: lugar.zona || '',
  });
  try {
    const r = await fetch(`/api/pronostico?${q}`);
    const datos = await r.json();
    if (!r.ok) throw new Error(datos.error);
    pintar(lugar, datos);
  } catch (e) {
    $('vacio').replaceChildren(icono('cloud_off'), el('p', {}, `No se pudo cargar el pronóstico. ${e.message || ''}`));
    $('vacio').hidden = false;
  } finally {
    $('cargando').hidden = true;
  }
}

function pintar(lugar, { promedio, fuentes }) {
  if (!promedio.length) {
    $('vacio').replaceChildren(icono('cloud_off'), el('p', {}, 'Ninguna fuente devolvió datos para este lugar.'));
    $('vacio').hidden = false;
    return;
  }
  document.title = `${lugar.nombre} · PromClim`;
  pintarHoy(lugar, promedio[0]);
  pintarDias(promedio);
  pintarFuentes(fuentes);
  pintarTabla(fuentes, promedio);
  $('contenido').hidden = false;
}

function pintarHoy(lugar, d) {
  const hoy = fecha(d.fecha);
  const n = Math.max(d.max?.n || 0, d.min?.n || 0);
  $('hoy').replaceChildren(
    el('p', { class: 'lugar' }, lugar.nombre),
    el('p', { class: 'sub' }, [lugar.detalle, `${DIAS_LARGOS[hoy.getDay()]} ${hoy.getDate()}`].filter(Boolean).join(' · ')),
    el('div', { class: 'temps' },
      el('span', { class: 'maxima' }, grados(d.max?.prom)),
      el('span', { class: 'minima' }, `/ ${grados(d.min?.prom)}`)),
    el('p', { class: 'rango' },
      `Promedio de ${n} ${n === 1 ? 'fuente' : 'fuentes'}`,
      d.max && d.max.n > 1 ? ` · la máxima va de ${grados(d.max.min)} a ${grados(d.max.max)}` : ''),
    el('div', { class: 'chips' },
      d.lluvia && el('span', { class: 'chip' }, icono('water_drop'), `${d.lluvia.prom} mm`),
      d.prob && el('span', { class: 'chip' }, icono('umbrella'), `${Math.round(d.prob.prom)} %`),
      d.viento && el('span', { class: 'chip' }, icono('air'), `${Math.round(d.viento.prom)} km/h`)),
  );
}

function pintarDias(promedio) {
  const dias = promedio.slice(1);
  const mins = dias.map((d) => d.min?.prom).filter((x) => x != null);
  const maxs = dias.map((d) => d.max?.prom).filter((x) => x != null);
  const piso = Math.min(...mins, ...maxs), techo = Math.max(...mins, ...maxs);
  const pos = (v) => ((v - piso) / (techo - piso || 1)) * 100;

  $('dias').replaceChildren(...dias.map((d) => {
    const f = fecha(d.fecha);
    const lo = d.min?.prom ?? d.max?.prom, hi = d.max?.prom ?? d.min?.prom;
    const lluvia = d.lluvia?.prom;
    return el('li', {},
      el('span', { class: 'dia' }, DIAS[f.getDay()], el('small', {}, `${f.getDate()}/${f.getMonth() + 1}`)),
      el('span', { class: 'agua' }, lluvia >= 0.1 ? [icono('water_drop'), `${lluvia} mm`] : ''),
      el('span', { class: 'min' }, grados(d.min?.prom)),
      el('div', { class: 'barra-temp' },
        el('span', { style: `left:${pos(lo)}%;right:${100 - pos(hi)}%` })),
      el('span', { class: 'max' }, grados(d.max?.prom)),
    );
  }));
}

function pintarFuentes(fuentes) {
  const iconos = { ok: 'check_circle', error: 'error', omitida: 'remove_circle' };
  $('fuentes').replaceChildren(...fuentes.map((f) => el('a', {
    class: `chip ${f.estado}`,
    href: f.web,
    target: '_blank',
    rel: 'noopener',
    title: f.motivo || f.nota || 'Ver la fuente',
  }, icono(iconos[f.estado]), f.nombre)));
}

function pintarTabla(fuentes, promedio) {
  const fechas = promedio.map((d) => d.fecha);
  const celda = (dias, fecha) => {
    const d = dias.find((x) => x.fecha === fecha);
    if (!d || (d.max === null && d.min === null)) return el('td', {}, el('span', { class: 'bajo' }, '·'));
    return el('td', {}, grados(d.max), el('span', { class: 'bajo' }, ` / ${grados(d.min)}`));
  };

  const filas = [];
  for (const f of fuentes.filter((x) => x.estado === 'ok')) {
    filas.push(el('tr', {}, el('td', {}, f.nombre), fechas.map((x) => celda(f.dias, x))));
    for (const [nombre, dias] of Object.entries(f.modelos || {})) {
      filas.push(el('tr', { class: 'modelo' }, el('td', {}, nombre), fechas.map((x) => celda(dias, x))));
    }
  }
  filas.push(el('tr', { class: 'total' }, el('td', {}, 'Promedio'),
    promedio.map((d) => el('td', {}, grados(d.max?.prom), el('span', { class: 'bajo' }, ` / ${grados(d.min?.prom)}`)))));

  $('tabla').replaceChildren(el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Máx / mín'),
      fechas.map((x) => { const f = fecha(x); return el('th', {}, `${DIAS[f.getDay()]} ${f.getDate()}`); }))),
    el('tbody', {}, filas)));
}

// Al abrir, mostrar el último lugar elegido.
const ultimo = recordar.leer();
if (ultimo) cargar(ultimo);
else input.focus();

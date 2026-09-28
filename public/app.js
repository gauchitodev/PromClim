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

let actual = null; // { lugar, datos } del último pronóstico cargado

const consulta = (lugar) => new URLSearchParams({
  lat: lugar.lat, lon: lugar.lon, nombre: lugar.nombre, detalle: lugar.detalle || '',
  pais: lugar.pais || '', zona: lugar.zona || '',
});

async function cargar(lugar) {
  $('vacio').hidden = true;
  $('contenido').hidden = true;
  $('cargando').hidden = false;
  try {
    const r = await fetch(`/api/pronostico?${consulta(lugar)}`);
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

function pintar(lugar, datos) {
  const { promedio, fuentes, acumulados } = datos;
  if (!promedio.length) {
    $('vacio').replaceChildren(icono('cloud_off'), el('p', {}, 'Ninguna fuente devolvió datos para este lugar.'));
    $('vacio').hidden = false;
    return;
  }
  actual = { lugar, datos };
  document.title = `${lugar.nombre} · PromClim`;
  pintarHoy(lugar, promedio[0]);
  reiniciarIA();
  pintarDias(promedio);
  pintarLluvia(acumulados);
  pintarFuentes(fuentes);
  pintarTabla();
  $('contenido').hidden = false;
}

const mm = (v) => (v < 1 && v > 0 ? `${v} mm` : `${Math.round(v)} mm`);
const consenso = (ll) => `${ll.si} de ${ll.de} ${ll.de === 1 ? 'fuente' : 'fuentes'}`;

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
      d.lluvia && el('span', { class: 'chip', title: `Entre ${d.lluvia.min} y ${d.lluvia.max} mm según la fuente` },
        icono('water_drop'), mm(d.lluvia.prom)),
      d.prob && el('span', { class: 'chip', title: 'Probabilidad de lluvia promedio' },
        icono('umbrella'), `${Math.round(d.prob.prom)} %`),
      d.llueve && el('span', { class: 'chip' }, icono('how_to_vote'), `Llueve para ${consenso(d.llueve)}`),
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
    const lluvia = d.lluvia?.prom ?? 0;
    const prob = d.prob ? Math.round(d.prob.prom) : null;
    const hayAgua = lluvia >= 0.1 || prob >= 30;
    return el('li', { title: d.llueve ? `Llueve para ${consenso(d.llueve)}` : '' },
      el('span', { class: 'dia' }, DIAS[f.getDay()], el('small', {}, `${f.getDate()}/${f.getMonth() + 1}`)),
      el('span', { class: `agua${hayAgua ? '' : ' seco'}` },
        icono('water_drop'),
        el('span', {}, hayAgua ? mm(lluvia) : '—',
          prob !== null ? el('small', {}, `${prob} %`) : '')),
      el('span', { class: 'min' }, grados(d.min?.prom)),
      el('div', { class: 'barra-temp' },
        el('span', { style: `left:${pos(lo)}%;right:${100 - pos(hi)}%` })),
      el('span', { class: 'max' }, grados(d.max?.prom)),
    );
  }));
}

function pintarLluvia(ac) {
  if (!ac?.fuentes.length) {
    $('lluvia').replaceChildren(el('p', { class: 'ia-ayuda' }, 'Ninguna fuente dio datos de lluvia.'));
    return;
  }
  const tope = Math.max(...ac.fuentes.map((f) => f.d7?.mm ?? 0), ac.promedio.d7, 1);
  $('lluvia').replaceChildren(
    el('div', { class: 'acumulados' },
      el('div', {}, el('span', { class: 'numero' }, mm(ac.promedio.d3)), el('small', {}, 'próximos 3 días')),
      el('div', {}, el('span', { class: 'numero' }, mm(ac.promedio.d7)), el('small', {}, 'próximos 7 días'))),
    el('p', { class: 'ia-ayuda' }, 'Promedio de todas las fuentes. Abajo, lo que suma cada una en 7 días:'),
    el('ul', { class: 'barras' }, ac.fuentes.map((f) => {
      const v = f.d7?.mm ?? 0;
      const incompleto = f.d7 && f.d7.dias < f.d7.de;
      return el('li', {},
        el('span', { class: 'nombre' }, f.nombre),
        el('div', { class: 'barra-lluvia' }, el('span', { style: `width:${(v / tope) * 100}%` })),
        el('span', { class: 'valor', title: incompleto ? `Solo tiene ${f.d7.dias} de ${f.d7.de} días` : '' },
          mm(v), incompleto ? el('small', {}, ` (${f.d7.dias} d)`) : ''));
    })),
  );
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

// ---------------------------------------------------------------------------
// Tabla por fuente (temperatura o lluvia)
// ---------------------------------------------------------------------------

let vistaTabla = 'temp';

$('vista-tabla').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  vistaTabla = b.dataset.vista;
  for (const x of $('vista-tabla').children) x.setAttribute('aria-selected', String(x === b));
  pintarTabla();
});

function pintarTabla() {
  if (!actual) return;
  const { fuentes, promedio } = actual.datos;
  const fechas = promedio.map((d) => d.fecha);
  const lluvia = vistaTabla === 'lluvia';

  const valor = (d) => {
    if (lluvia) {
      if (d.lluvia === null && d.prob === null) return null;
      return [d.lluvia === null ? '–' : `${d.lluvia}`, el('span', { class: 'bajo' }, d.prob === null ? '' : ` ${Math.round(d.prob)}%`)];
    }
    if (d.max === null && d.min === null) return null;
    return [grados(d.max), el('span', { class: 'bajo' }, ` / ${grados(d.min)}`)];
  };
  const celda = (dias, f) => {
    const d = dias.find((x) => x.fecha === f);
    const v = d && valor(d);
    return el('td', {}, v || el('span', { class: 'bajo' }, '·'));
  };

  const filas = [];
  for (const f of fuentes.filter((x) => x.estado === 'ok')) {
    const dias = f.dias.filter((d) => valor(d));
    if (!dias.length) continue;
    filas.push(el('tr', {}, el('td', {}, f.nombre), fechas.map((x) => celda(f.dias, x))));
    for (const [nombre, dm] of Object.entries(f.modelos || {})) {
      filas.push(el('tr', { class: 'modelo' }, el('td', {}, nombre), fechas.map((x) => celda(dm, x))));
    }
  }
  filas.push(el('tr', { class: 'total' }, el('td', {}, 'Promedio'), promedio.map((d) => el('td', {},
    lluvia
      ? [d.lluvia ? `${d.lluvia.prom}` : '–', el('span', { class: 'bajo' }, d.prob ? ` ${Math.round(d.prob.prom)}%` : '')]
      : [grados(d.max?.prom), el('span', { class: 'bajo' }, ` / ${grados(d.min?.prom)}`)]))));

  $('tabla').replaceChildren(el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, lluvia ? 'mm / prob.' : 'Máx / mín'),
      fechas.map((x) => { const f = fecha(x); return el('th', {}, `${DIAS[f.getDay()]} ${f.getDate()}`); }))),
    el('tbody', {}, filas)));
}

// ---------------------------------------------------------------------------
// Análisis con IA (Ollama en la propia compu)
// ---------------------------------------------------------------------------

function reiniciarIA() {
  $('ia-texto').hidden = true;
  $('ia-texto').replaceChildren();
  $('ia-ayuda').hidden = false;
  $('analizar').disabled = false;
  $('analizar').textContent = 'Analizar';
}

/** Markdown mínimo: **negrita**, listas con "- " y párrafos. Sin HTML crudo. */
function pintarMarkdown(texto) {
  const bloques = [];
  let lista = null;
  for (const linea of texto.split('\n')) {
    const t = linea.trim();
    if (!t) { lista = null; continue; }
    const conNegrita = t.replace(/^[-*•]\s+/, '').split(/\*\*(.+?)\*\*/g)
      .map((parte, i) => (i % 2 ? el('strong', {}, parte) : parte));
    if (/^[-*•]\s+/.test(t)) {
      if (!lista) { lista = el('ul'); bloques.push(lista); }
      lista.append(el('li', {}, conNegrita));
    } else {
      lista = null;
      bloques.push(el('p', {}, conNegrita));
    }
  }
  return bloques;
}

$('analizar').addEventListener('click', async () => {
  if (!actual) return;
  const boton = $('analizar');
  const caja = $('ia-texto');
  boton.disabled = true;
  boton.textContent = 'Pensando…';
  $('ia-ayuda').hidden = true;
  caja.hidden = false;
  caja.replaceChildren(el('p', { class: 'ia-espera' }, el('span', { class: 'girando chico' }),
    'La IA está leyendo las fuentes. En una compu sin placa de video puede tardar un minuto.'));

  try {
    const r = await fetch(`/api/analisis?${consulta(actual.lugar)}`);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return mostrarErrorIA(e);
    }
    const decoder = new TextDecoder();
    const lector = r.body.getReader();
    let texto = '';
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      texto += decoder.decode(value, { stream: true });
      caja.replaceChildren(...pintarMarkdown(texto));
    }
    caja.append(el('p', { class: 'ia-pie' }, 'Escrito por una IA a partir de los datos de arriba. Puede equivocarse.'));
    boton.textContent = 'Listo';
  } catch (e) {
    mostrarErrorIA({ error: e.message });
  }
});

function mostrarErrorIA(e) {
  const caja = $('ia-texto');
  const pasos = {
    'sin-ollama': [
      'Para el análisis hace falta Ollama, que corre la IA en tu compu, gratis y sin cuentas.',
      'En Arch Linux: sudo pacman -S ollama && sudo systemctl enable --now ollama',
      'En otros sistemas: https://ollama.com/download',
      `Después bajá el modelo: ollama pull ${e.modelo || 'gemma3:4b'}`,
    ],
    'sin-modelo': [
      'Ollama está andando, pero falta bajar el modelo. En una terminal:',
      `ollama pull ${e.modelo || 'gemma3:4b'}`,
    ],
  }[e.codigo] || [`No se pudo hacer el análisis: ${e.error || 'error desconocido'}`];
  caja.replaceChildren(...pasos.map((p, i) => el(i && /^(sudo|ollama|https)/.test(p) ? 'pre' : 'p', {}, p)));
  $('analizar').disabled = false;
  $('analizar').textContent = 'Reintentar';
}

// Al abrir, mostrar el último lugar elegido.
const ultimo = recordar.leer();
if (ultimo) cargar(ultimo);
else input.focus();

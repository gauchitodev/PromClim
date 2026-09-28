/**
 * Análisis con IA usando Ollama: un modelo que corre en la propia compu,
 * gratis y sin clave. Le pasamos lo que dijo cada fuente y el promedio, y
 * escribe un análisis corto. El texto se manda de a pedazos a medida que
 * sale, así no hay que esperar a que termine para empezar a leer.
 */

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_ANALIZADOS = 7;

const SISTEMA = `Sos un meteorólogo que le explica el pronóstico a gente común, en español rioplatense, claro y directo.
Te paso HECHOS ya calculados a partir de varias fuentes del clima, y una tabla con el promedio por día.

Reglas:
- Los HECHOS son correctos: repetilos con tus palabras, no los contradigas y no agregues datos que no estén.
- Nombrá los días como vienen (hoy, el martes). No uses fechas.
- Redondeá: grados enteros, milímetros enteros salvo que sean menos de 1.
- Los consejos tienen que salir de los datos (paraguas, abrigo, viento). Nada de consejos genéricos.

Escribí estas secciones, con el título en negrita:
**Resumen**: dos o tres frases con lo más importante de la semana.
**Lluvia**: qué días llueve y cuánto, cuáles están secos, el acumulado y qué tan de acuerdo están las fuentes.
**Temperaturas**: cómo vienen, el día más frío y el más caluroso.
**Dónde no coinciden**: lo que dicen los HECHOS sobre desacuerdos.
**Consejo**: una o dos recomendaciones prácticas.

No pases de 200 palabras.`;

const r0 = (x) => (x === null || x === undefined ? '–' : String(Math.round(x)));
const mm = (x) => (x === null || x === undefined ? '–' : x < 1 ? String(x) : String(Math.round(x)));

function nombreDia(fecha, hoy) {
  const f = new Date(`${fecha}T12:00:00Z`);
  const nombre = DIAS[f.getUTCDay()];
  return fecha === hoy ? `hoy (${nombre})` : `el ${nombre}`;
}

const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0] || '');

/** Qué fuente da el valor más bajo y el más alto de un campo ese día. */
function extremos(fuentes, fecha, campo) {
  const v = fuentes
    .map((f) => ({ nombre: f.nombre, x: f.dias.find((d) => d.fecha === fecha)?.[campo] }))
    .filter((e) => e.x !== null && e.x !== undefined)
    .sort((a, b) => a.x - b.x);
  return v.length > 1 ? { bajo: v[0], alto: v.at(-1) } : null;
}

/**
 * Las cuentas las hacemos acá y no la IA: un modelo chico se equivoca
 * buscando el día más frío o qué días llueve, pero explica bien lo que le damos.
 */
function hechos(datos, dias, hoy) {
  const ok = datos.fuentes.filter((f) => f.estado === 'ok');
  const h = [];
  const llueve = (d) => (d.lluvia?.prom ?? 0) >= 1 || (d.llueve && d.llueve.si * 2 > d.llueve.de);
  const seco = (d) => (d.lluvia?.prom ?? 0) < 0.5 && (!d.llueve || d.llueve.si === 0);

  const conLluvia = dias.filter(llueve);
  if (conLluvia.length) {
    h.push('Días con lluvia:');
    for (const d of conLluvia) {
      const partes = [`${mm(d.lluvia?.prom)} mm promedio`];
      if (d.llueve) partes.push(`${d.llueve.si} de ${d.llueve.de} fuentes dan lluvia`);
      if (d.prob) partes.push(`probabilidad ${r0(d.prob.prom)}%`);
      h.push(`- ${nombreDia(d.fecha, hoy)}: ${partes.join(', ')}`);
    }
    const peor = conLluvia.reduce((a, b) => ((b.lluvia?.prom ?? 0) > (a.lluvia?.prom ?? 0) ? b : a));
    h.push(`El día más lluvioso es ${nombreDia(peor.fecha, hoy)}.`);
  } else {
    h.push('No se espera lluvia importante en toda la semana.');
  }
  const secos = dias.filter(seco).map((d) => nombreDia(d.fecha, hoy));
  if (secos.length) h.push(`Días secos: ${lista(secos)}.`);
  const dudosos = dias.filter((d) => !llueve(d) && !seco(d)).map((d) => nombreDia(d.fecha, hoy));
  if (dudosos.length) h.push(`Días con alguna lluvia débil o dudosa: ${lista(dudosos)}.`);
  h.push(`Lluvia acumulada: ${mm(datos.acumulados.promedio.d3)} mm en los próximos 3 días y ${mm(datos.acumulados.promedio.d7)} mm en 7 días.`);

  const conMin = dias.filter((d) => d.min);
  const conMax = dias.filter((d) => d.max);
  if (conMin.length) {
    const frio = conMin.reduce((a, b) => (b.min.prom < a.min.prom ? b : a));
    h.push(`La mínima más baja es ${nombreDia(frio.fecha, hoy)}: ${r0(frio.min.prom)}°.`);
  }
  if (conMax.length) {
    const calor = conMax.reduce((a, b) => (b.max.prom > a.max.prom ? b : a));
    h.push(`La máxima más alta es ${nombreDia(calor.fecha, hoy)}: ${r0(calor.max.prom)}°.`);
  }

  const desacuerdos = [];
  for (const d of dias) {
    if (d.max && d.max.max - d.max.min >= 4) {
      const e = extremos(ok, d.fecha, 'max');
      if (e) desacuerdos.push(`${nombreDia(d.fecha, hoy)} la máxima va de ${r0(e.bajo.x)}° (${e.bajo.nombre}) a ${r0(e.alto.x)}° (${e.alto.nombre})`);
    }
    if (d.lluvia && d.lluvia.max - d.lluvia.min >= 8) {
      const e = extremos(ok, d.fecha, 'lluvia');
      if (e) desacuerdos.push(`${nombreDia(d.fecha, hoy)} la lluvia va de ${mm(e.bajo.x)} mm (${e.bajo.nombre}) a ${mm(e.alto.x)} mm (${e.alto.nombre})`);
    }
  }
  h.push(desacuerdos.length
    ? `Desacuerdos entre fuentes:\n${desacuerdos.map((x) => `- ${x}`).join('\n')}`
    : 'Las fuentes coinciden bastante todos los días.');
  h.push(`Fuentes consultadas: ${ok.map((f) => f.nombre).join(', ')}.`);
  return h;
}

/** Arma el mensaje con los datos, compacto para que un modelo chico lo procese rápido. */
export function armarPrompt(datos) {
  const { lugar, promedio } = datos;
  const dias = promedio.slice(0, DIAS_ANALIZADOS);
  const hoy = dias[0]?.fecha;

  const tabla = dias.map((d) => {
    const partes = [`máx ${r0(d.max?.prom)}°`, `mín ${r0(d.min?.prom)}°`];
    if (d.lluvia) partes.push(`lluvia ${mm(d.lluvia.prom)} mm`);
    if (d.prob) partes.push(`probabilidad ${r0(d.prob.prom)}%`);
    if (d.viento) partes.push(`viento hasta ${r0(d.viento.prom)} km/h`);
    return `- ${nombreDia(d.fecha, hoy)}: ${partes.join(', ')}`;
  });

  return [
    `Lugar: ${lugar.nombre}${lugar.detalle ? `, ${lugar.detalle}` : ''}.`,
    '',
    'HECHOS:',
    ...hechos(datos, dias, hoy),
    '',
    'PROMEDIO POR DÍA:',
    ...tabla,
  ].join('\n');
}

/**
 * Pide el análisis a Ollama y va llamando a `alRecibir(texto)` con cada pedazo.
 * Tira un error con `codigo` = 'sin-ollama' o 'sin-modelo' para que la
 * página pueda explicar qué falta. `signal` corta todo (por ejemplo, si se
 * cierra la página); además hay un tope de 5 minutos.
 */
export async function analizar(datos, config, alRecibir, signal) {
  const url = config.ia?.url || 'http://127.0.0.1:11434';
  const modelo = config.ia?.modelo || 'gemma3:4b';
  const corte = AbortSignal.any([signal, AbortSignal.timeout(5 * 60e3)].filter(Boolean));

  let r;
  try {
    r = await fetch(`${url}/api/chat`, {
      method: 'POST',
      signal: corte,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelo,
        stream: true,
        options: { temperature: 0.3, num_ctx: 8192 },
        messages: [
          { role: 'system', content: SISTEMA },
          { role: 'user', content: armarPrompt(datos) },
        ],
      }),
    });
  } catch (e) {
    if (corte.aborted) throw e;
    throw Object.assign(new Error(`No encontré Ollama en ${url}. ¿Está instalado y prendido?`), { codigo: 'sin-ollama', modelo });
  }

  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    if (r.status === 404) {
      throw Object.assign(new Error(`Falta bajar el modelo: ollama pull ${modelo}`), { codigo: 'sin-modelo', modelo });
    }
    throw new Error(cuerpo.error || `Ollama respondió HTTP ${r.status}`);
  }

  // Ollama manda una línea JSON por pedazo: {"message":{"content":"..."},"done":false}
  const decoder = new TextDecoder();
  let resto = '';
  for await (const trozo of r.body) {
    resto += decoder.decode(trozo, { stream: true });
    const lineas = resto.split('\n');
    resto = lineas.pop();
    for (const linea of lineas) {
      if (!linea.trim()) continue;
      const msg = JSON.parse(linea);
      if (msg.error) throw new Error(msg.error);
      if (msg.message?.content) alRecibir(msg.message.content);
    }
  }
}

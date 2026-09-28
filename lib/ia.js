/**
 * Análisis con IA usando Ollama: un modelo que corre en la propia compu,
 * gratis y sin clave. Le pasamos lo que dijo cada fuente y el promedio, y
 * escribe un análisis corto. El texto se manda de a pedazos a medida que
 * sale, así no hay que esperar a que termine para empezar a leer.
 */

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_ANALIZADOS = 7;

const SISTEMA = `Sos un meteorólogo que le explica el pronóstico a gente común, en español rioplatense, claro y directo.
Vas a recibir lo que dicen varias fuentes del clima para un lugar y el promedio entre ellas.

Reglas:
- Usá solamente los datos que te paso. No inventes fenómenos ni números.
- Redondeá: grados enteros y milímetros sin decimales salvo que sean menos de 1.
- Nombrá los días por su nombre (el lunes, el martes), no por la fecha.
- Si las fuentes no coinciden, decilo y explicá qué tan seguro es el pronóstico.

Escribí estas secciones, con el título en negrita:
**Resumen**: dos o tres frases con lo más importante de la semana.
**Lluvia**: qué días llueve, cuánto se acumula y qué tan de acuerdo están las fuentes (usá "X de N fuentes" y la probabilidad).
**Temperaturas**: cómo vienen, cuál es el día más frío y el más caluroso.
**Dónde no coinciden**: los días en que las fuentes se separan mucho, o "Coinciden bastante" si no pasa.
**Consejo**: una o dos recomendaciones prácticas.

No pases de 220 palabras.`;

const r0 = (x) => (x === null || x === undefined ? '–' : String(Math.round(x)));
const mm = (x) => (x === null || x === undefined ? '–' : x < 1 ? String(x) : String(Math.round(x)));

function nombreDia(fecha, hoy) {
  const f = new Date(`${fecha}T12:00:00Z`);
  const nombre = DIAS[f.getUTCDay()];
  return fecha === hoy ? `hoy (${nombre})` : nombre;
}

/** Arma el mensaje con los datos, compacto para que un modelo chico lo procese rápido. */
export function armarPrompt(datos) {
  const { lugar, promedio, acumulados, fuentes } = datos;
  const dias = promedio.slice(0, DIAS_ANALIZADOS);
  const hoy = dias[0]?.fecha;
  const lineas = [];

  lineas.push(`Lugar: ${lugar.nombre}${lugar.detalle ? `, ${lugar.detalle}` : ''}.`);
  lineas.push('');
  lineas.push('PROMEDIO DE TODAS LAS FUENTES (entre corchetes, el rango entre fuentes):');
  for (const d of dias) {
    const partes = [
      `máx ${r0(d.max?.prom)}° [${r0(d.max?.min)} a ${r0(d.max?.max)}]`,
      `mín ${r0(d.min?.prom)}° [${r0(d.min?.min)} a ${r0(d.min?.max)}]`,
    ];
    if (d.lluvia) partes.push(`lluvia ${mm(d.lluvia.prom)} mm [${mm(d.lluvia.min)} a ${mm(d.lluvia.max)}]`);
    if (d.llueve) partes.push(`${d.llueve.si} de ${d.llueve.de} fuentes dan lluvia`);
    if (d.prob) partes.push(`probabilidad ${r0(d.prob.prom)}%`);
    if (d.viento) partes.push(`viento máx ${r0(d.viento.prom)} km/h`);
    lineas.push(`- ${nombreDia(d.fecha, hoy)}: ${partes.join(', ')}`);
  }
  lineas.push('');
  lineas.push(`Lluvia acumulada promedio: ${mm(acumulados.promedio.d3)} mm en 3 días, ${mm(acumulados.promedio.d7)} mm en 7 días.`);

  lineas.push('');
  lineas.push('CADA FUENTE, por día (máx/mín en °C y lluvia en mm):');
  const fechas = new Set(dias.map((d) => d.fecha));
  for (const f of fuentes.filter((x) => x.estado === 'ok')) {
    const valores = f.dias
      .filter((d) => fechas.has(d.fecha))
      .map((d) => {
        const t = d.max !== null || d.min !== null ? `${r0(d.max)}/${r0(d.min)}` : '';
        const l = d.lluvia !== null ? `${mm(d.lluvia)}mm` : '';
        const p = d.prob !== null ? `${r0(d.prob)}%` : '';
        return `${nombreDia(d.fecha, hoy).replace(/ \(.*\)/, '')} ${[t, l, p].filter(Boolean).join(' ')}`;
      });
    if (valores.length) lineas.push(`- ${f.nombre}${f.nota ? ` (${f.nota})` : ''}: ${valores.join('; ')}`);
  }
  lineas.push('');
  lineas.push('Nota: "Ensambles" no da temperaturas; su probabilidad sale de cuántos de sus escenarios dan 1 mm o más.');

  return lineas.join('\n');
}

/**
 * Pide el análisis a Ollama y va llamando a `alRecibir(texto)` con cada pedazo.
 * Tira un error con `codigo` = 'sin-ollama' o 'sin-modelo' para que la
 * página pueda explicar qué falta.
 */
export async function analizar(datos, config, alRecibir) {
  const url = config.ia?.url || 'http://127.0.0.1:11434';
  const modelo = config.ia?.modelo || 'gemma3:4b';

  let r;
  try {
    r = await fetch(`${url}/api/chat`, {
      method: 'POST',
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
  } catch {
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

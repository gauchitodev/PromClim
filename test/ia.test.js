import { test } from 'node:test';
import assert from 'node:assert/strict';

import { armarPrompt } from '../lib/ia.js';

// Semana de ejemplo: el 2026-10-01 es jueves.
const c = (prom, min = prom, max = prom, n = 3) => ({ prom, min, max, n });
const datos = {
  lugar: { nombre: 'Ejemplo', detalle: 'Uruguay' },
  promedio: [
    { fecha: '2026-10-01', max: c(20), min: c(12), lluvia: c(8, 0.5, 14), prob: c(85), llueve: { si: 3, de: 4 }, viento: null },
    { fecha: '2026-10-02', max: c(17, 15, 21), min: c(5), lluvia: c(0), prob: c(5), llueve: { si: 0, de: 4 }, viento: null },
    { fecha: '2026-10-03', max: c(24), min: c(9), lluvia: c(0.7, 0, 1.2), prob: c(30), llueve: { si: 1, de: 4 }, viento: null },
  ],
  acumulados: { promedio: { d3: 8.7, d7: 8.7 } },
  fuentes: [
    { nombre: 'Una', estado: 'ok', dias: [{ fecha: '2026-10-01', max: 20, min: 12, lluvia: 0.5, prob: null }, { fecha: '2026-10-02', max: 15, min: 5, lluvia: 0, prob: null }] },
    { nombre: 'Otra', estado: 'ok', dias: [{ fecha: '2026-10-01', max: 20, min: 12, lluvia: 14, prob: null }, { fecha: '2026-10-02', max: 21, min: 5, lluvia: 0, prob: null }] },
    { nombre: 'Rota', estado: 'error', dias: [] },
  ],
};

test('los hechos para la IA ya traen lo que un modelo chico calcula mal', () => {
  const p = armarPrompt(datos);
  assert.match(p, /- hoy \(jueves\): 8 mm promedio, 3 de 4 fuentes dan lluvia, probabilidad 85%/);
  assert.match(p, /Días secos: el viernes\./);
  assert.match(p, /lluvia débil o dudosa: el sábado\./);
  assert.match(p, /La mínima más baja es el viernes: 5°\./);
  assert.match(p, /La máxima más alta es el sábado: 24°\./);
});

test('los desacuerdos nombran qué fuente dice cada extremo', () => {
  const p = armarPrompt(datos);
  assert.match(p, /hoy \(jueves\) la lluvia va de 0\.5 mm \(Una\) a 14 mm \(Otra\)/);
  assert.match(p, /el viernes la máxima va de 15° \(Una\) a 21° \(Otra\)/);
});

test('las fuentes con error no aparecen como consultadas', () => {
  assert.match(armarPrompt(datos), /Fuentes consultadas: Una, Otra\./);
});

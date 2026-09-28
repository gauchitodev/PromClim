import { test } from 'node:test';
import assert from 'node:assert/strict';

import { promediarListas, promedioGeneral, acumulados } from '../lib/promedio.js';

const dia = (fecha, max, min, lluvia = null, prob = null) => ({ fecha, max, min, lluvia, prob, viento: null });

test('promedia por fecha e ignora los null', () => {
  const r = promediarListas([
    [dia('2026-10-01', 20, 10, 4)],
    [dia('2026-10-01', 22, null, null)],
  ]);
  assert.deepEqual(r, [{ fecha: '2026-10-01', max: 21, min: 10, lluvia: 4, prob: null, viento: null }]);
});

test('el promedio general da rango, cantidad de fuentes y cuántas dan lluvia', () => {
  const [d] = promedioGeneral([
    [dia('2026-10-01', 18, 10, 0)],
    [dia('2026-10-01', 20, 12, 3)],
    [dia('2026-10-01', 22, 14, 6)],
  ]);
  assert.deepEqual(d.max, { prom: 20, min: 18, max: 22, n: 3 });
  assert.deepEqual(d.lluvia, { prom: 3, min: 0, max: 6, n: 3 });
  // 1 mm o más cuenta como "llueve": 3 y 6 sí, 0 no.
  assert.deepEqual(d.llueve, { si: 2, de: 3 });
});

test('descarta los días anteriores a hoy y los que no tienen temperatura', () => {
  const r = promedioGeneral([
    [dia('2026-09-30', 20, 10), dia('2026-10-01', 21, 11), { ...dia('2026-10-02', null, null), lluvia: 5 }],
  ], '2026-10-01');
  assert.deepEqual(r.map((d) => d.fecha), ['2026-10-01']);
});

test('la lluvia acumulada cuenta cuántos días cubre cada fuente', () => {
  const corta = { nombre: 'Corta', dias: [dia('2026-10-01', 20, 10, 2), dia('2026-10-02', 20, 10, 3)] };
  const larga = { nombre: 'Larga', dias: ['01', '02', '03', '04', '05', '06', '07'].map((d) => dia(`2026-10-${d}`, 20, 10, 1)) };
  const promedio = promedioGeneral([corta.dias, larga.dias]);
  const ac = acumulados([corta, larga], promedio);

  assert.deepEqual(ac.fuentes.find((f) => f.nombre === 'Corta').d7, { mm: 5, dias: 2, de: 7 });
  assert.deepEqual(ac.fuentes.find((f) => f.nombre === 'Larga').d7, { mm: 7, dias: 7, de: 7 });
  // Promedio por día: 1.5, 2, 1, 1, 1, 1, 1
  assert.equal(ac.promedio.d3, 4.5);
  assert.equal(ac.promedio.d7, 8.5);
});

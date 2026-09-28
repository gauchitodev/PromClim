import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agruparPorDia, fechaLocal, num } from '../lib/util.js';

test('num acepta textos con números y rechaza lo demás', () => {
  assert.equal(num('07'), 7);
  assert.equal(num('1.4'), 1.4);
  assert.equal(num(''), null);
  assert.equal(num('nada'), null);
  assert.equal(num(undefined), null);
});

test('la fecha local depende de la zona horaria', () => {
  const t = new Date('2026-10-01T02:00:00Z'); // 23:00 del 30 en Uruguay (UTC-3)
  assert.equal(fechaLocal(t, 'America/Montevideo'), '2026-09-30');
  assert.equal(fechaLocal(t, 'Europe/Madrid'), '2026-10-01');
});

test('agrupa horas en días locales: máx, mín, lluvia sumada, probabilidad máxima', () => {
  // 24 horas del 1 de octubre en Uruguay (03:00 UTC a 02:00 UTC del día siguiente)
  const puntos = Array.from({ length: 24 }, (_, h) => ({
    t: new Date(Date.UTC(2026, 9, 1, 3 + h)),
    horas: 1,
    temp: 10 + h / 2,
    lluvia: h === 12 ? 2.5 : 0.1,
    prob: h === 12 ? 80 : 10,
    viento: 5,
  }));
  const [d] = agruparPorDia(puntos, 'America/Montevideo');
  assert.equal(d.fecha, '2026-10-01');
  assert.equal(d.min, 10);
  assert.equal(d.max, 21.5);
  assert.equal(d.lluvia, 4.8); // 2.5 + 23 × 0.1
  assert.equal(d.prob, 80);
});

test('descarta los días con menos de 18 horas de datos', () => {
  const puntos = Array.from({ length: 6 }, (_, h) => ({
    t: new Date(Date.UTC(2026, 9, 1, 15 + h)), horas: 1, temp: 20, lluvia: 0, prob: null, viento: null,
  }));
  assert.deepEqual(agruparPorDia(puntos, 'America/Montevideo'), []);
});

test('un período de 6 horas aporta su máxima y su mínima', () => {
  const puntos = [0, 6, 12, 18].map((h) => ({
    t: new Date(Date.UTC(2026, 9, 1, 3 + h + 3)), horas: 6, temp: [20 + h / 6, 8 + h / 6], lluvia: 1, prob: null, viento: null,
  }));
  const [d] = agruparPorDia(puntos, 'America/Montevideo');
  assert.equal(d.max, 23);
  assert.equal(d.min, 8);
  assert.equal(d.lluvia, 4);
});

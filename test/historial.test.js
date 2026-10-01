import { test } from 'node:test';
import assert from 'node:assert/strict';

import { acerto } from '../lib/historial.js';

test('acierta temperatura con 1° o menos entre los números que se muestran', () => {
  // 9,3 contra 7,7 se muestran 9° y 8°: 1° de diferencia, acierto.
  assert.equal(acerto({ max: 17, min: 9.3 }, { max: 17.1, min: 7.7 }).temp, true);
  // 9,6 contra 7,4 se muestran 10° y 7°: le erró.
  assert.equal(acerto({ max: 17, min: 9.6 }, { max: 17.1, min: 7.4 }).temp, false);
  // Sin datos no hay veredicto.
  assert.equal(acerto({ max: null, min: null }, { max: 17, min: 8 }).temp, null);
});

test('acierta lluvia si acertó que llovía o no, y por menos de 3 mm', () => {
  assert.equal(acerto({ lluvia: 0.3 }, { lluvia: 0 }).lluvia, true);
  assert.equal(acerto({ lluvia: 3.2 }, { lluvia: 9 }).lluvia, false);
  assert.equal(acerto({ lluvia: 18.9 }, { lluvia: 0.1 }).lluvia, false);
  assert.equal(acerto({ lluvia: 5 }, { lluvia: 6.5 }).lluvia, true);
  assert.equal(acerto({ lluvia: null }, { lluvia: 2 }).lluvia, null);
});

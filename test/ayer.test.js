import { test } from 'node:test';
import assert from 'node:assert/strict';

import { conclusiones } from '../lib/ayer.js';
import { ahora, direccionTexto, horasDelDia, serieEstacion } from '../lib/estacion.js';

test('temperaturas dentro de 1,5° salen "como se esperaba"', () => {
  const f = conclusiones({ max: 20.8, min: 13.8, lluvia: 0 }, { max: 22, min: 14.1, lluvia: 0 });
  assert.deepEqual(f, [
    'Las temperaturas salieron como se esperaba: máxima de 21° y mínima de 14°.',
    'No llovió, como se esperaba.',
  ]);
});

test('dice cuánto más o menos hizo, y la lluvia que no se esperaba', () => {
  const fuentes = [
    { nombre: 'A', max: 22, min: 12, lluvia: 0 },
    { nombre: 'B', max: 19, min: 10, lluvia: 12 },
    { nombre: 'C', max: 17.1, min: 11, lluvia: 3 },
  ];
  const f = conclusiones({ max: 16.1, min: 11.8, lluvia: 18.9 }, { max: 19.7, min: 10.3, lluvia: 0.5 }, fuentes);
  assert.equal(f[0], 'La máxima fue de 16°: 4° menos de lo pronosticado (20°).');
  assert.equal(f[1], 'La mínima fue de 12°: 2° más de lo pronosticado (10°).');
  assert.equal(f[2], 'Llovieron 19 mm y el pronóstico no lo esperaba. La daban 2 de 3 fuentes.');
  assert.equal(f[3], 'En temperatura, la que más se acercó fue C: le erró por 0.9° en promedio.');
  assert.equal(f[4], 'En lluvia, la más cercana fue B, que dio 12 mm.');
});

test('lluvia de más o de menos, y ráfagas fuertes', () => {
  assert.match(conclusiones({ lluvia: 30 }, { lluvia: 10 })[0], /más de lo esperado: 30 mm contra 10 mm/);
  assert.match(conclusiones({ lluvia: 2 }, { lluvia: 10 })[0], /menos de lo esperado/);
  assert.match(conclusiones({ lluvia: 9 }, { lluvia: 10 })[0], /lo que se esperaba/);
  assert.equal(conclusiones({ lluvia: 0.3 }, { lluvia: 6 })[0], 'Se esperaban 6 mm y casi no llovió (0.3 mm).');
  assert.deepEqual(conclusiones({}, {}, [], 51.4), ['Hubo ráfagas de hasta 51 km/h.']);
  assert.deepEqual(conclusiones({}, {}, [], 40), []);
});

// Formato de INUMET con una estación y 30 horas desde el 1/9 a las 00:00 de Uruguay.
const horas = Array.from({ length: 30 }, (_, h) => new Date(Date.UTC(2026, 8, 1, 3 + h)).toISOString());
const serie = (f) => ({ iFechas: horas.map((_, i) => i), datos: [horas.map((_, h) => f(h))] });
const crudo = {
  fechas: horas,
  estaciones: [{ id: 7, nombre: 'X' }],
  variables: ['TempAire', 'precipHoraria', 'PresAtmMar', 'IntVientMaxHora', 'DirViento'].map((idStr) => ({ idStr })),
  observaciones: [
    serie((h) => 10 + (h % 24) / 2),
    serie((h) => (h === 1 ? 4 : 0)),
    serie((h) => 1015 - h),
    serie((h) => (h === 5 ? 60 : 20)),
    serie(() => 135),
  ],
};

test('ahora: última hora, presión bajando rápido y lluvia de 24 horas', () => {
  const a = ahora(serieEstacion(crudo, 7));
  assert.equal(a.temp, 12.5);
  assert.deepEqual(a.presion, { hPa: 986, cambio3h: -3, tendencia: 'bajando rápido' });
  assert.equal(a.direccion, 'del sureste');
  // Las últimas 24 horas ya no incluyen la lluvia de la hora 1.
  assert.equal(a.lluvia24, 0);
  assert.equal(direccionTexto(null), null);
});

test('horas del día: la lluvia va a la hora anterior, y la ráfaga más fuerte', () => {
  const { horas: h, rafaga } = horasDelDia(serieEstacion(crudo, 7), '2026-09-01', 'America/Montevideo');
  assert.equal(h.length, 24);
  assert.equal(h[0].temp, 10);
  assert.equal(h[23].temp, 21.5);
  // La lectura de la 01:00 (4 mm) es la lluvia de las 00:00 a las 01:00.
  assert.equal(h[0].lluvia, 4);
  assert.equal(rafaga, 60);
});

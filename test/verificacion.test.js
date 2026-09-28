import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  estacionCercana, evaluar, observacionesPorDia, pesos, registrarPronostico, MIN_DIAS_PONDERAR,
} from '../lib/verificacion.js';

// Formato de INUMET: variables × estaciones × horas. Dos estaciones, 24 horas
// del 1 de septiembre de 2026 en Uruguay (01:00 a 24:00), más una hora del día 2.
const horas = Array.from({ length: 25 }, (_, h) => new Date(Date.UTC(2026, 8, 1, 4 + h)).toISOString());
const crudo = {
  variables: [{ idStr: 'TempAire' }, { idStr: 'precipHoraria' }],
  fechas: horas,
  estaciones: [
    { id: 1, nombre: 'Cerca', tipoAutomatica: true, latitud: -33.50, longitud: -56.90 },
    { id: 2, nombre: 'Lejos', tipoAutomatica: true, latitud: -34.90, longitud: -56.20 },
    { id: 3, nombre: 'Manual', tipoAutomatica: false, latitud: -33.52, longitud: -56.90 },
  ],
  observaciones: [
    { iFechas: horas.map((_, i) => i), datos: [
      horas.map((_, h) => 10 + h / 2), horas.map(() => 15), horas.map(() => 15),
    ] },
    { iFechas: horas.map((_, i) => i), datos: [
      horas.map((_, h) => (h === 5 ? 3 : 0.1)), horas.map(() => 0), horas.map(() => null),
    ] },
  ],
};

test('pasa las horas de INUMET a días: máxima, mínima y lluvia sumada', () => {
  const obs = observacionesPorDia(crudo, 'America/Montevideo');
  // Temperatura: 01:00 a 23:00 son del día 1 (la de las 24:00 ya es del 2).
  // Lluvia: la de cada hora es de la hora anterior, así que 01:00 a 24:00 son del día 1.
  assert.deepEqual(obs[1]['2026-09-01'], { max: 21, min: 10, lluvia: 5.3 });
  // El día 2 tiene 2 horas: no alcanza para dar el día por bueno.
  assert.equal(obs[1]['2026-09-02'], undefined);
});

test('elige la estación automática completa más cercana, no las manuales', () => {
  assert.deepEqual(estacionCercana(crudo, -33.52, -56.90), { id: 1, nombre: 'Cerca', km: 2.2 });
  // A más de 40 km de todas: ninguna.
  assert.equal(estacionCercana(crudo, -31.0, -55.0), null);
});

test('evalúa solo pronósticos hechos al menos un día antes', () => {
  const emisiones = {
    '2026-09-29': { a: [{ fecha: '2026-10-01', max: 20, min: 12, lluvia: 0 }] },
    '2026-09-30': { a: [{ fecha: '2026-10-01', max: 24, min: 10, lluvia: 6 }] },
    '2026-10-01': { a: [{ fecha: '2026-10-01', max: 99, min: 99, lluvia: 99 }] }, // mismo día: no cuenta
  };
  const obs = { '2026-10-01': { max: 22, min: 10, lluvia: 5 } };
  assert.deepEqual(evaluar(emisiones, obs).a, {
    dias: 1, comparaciones: 6, errorMax: 2, errorMin: 1, errorLluvia: 3, aciertoLluvia: 50,
  });
});

test('sin días suficientes no hay pesos; con días, pesa más el que menos se equivoca', () => {
  const poco = { a: { dias: 3, errorMax: 1, errorMin: 1, errorLluvia: 1 } };
  assert.equal(pesos(poco, ['a']), null);

  const mucho = {
    buena: { dias: MIN_DIAS_PONDERAR, errorMax: 1, errorMin: 1, errorLluvia: 2 },
    mala: { dias: MIN_DIAS_PONDERAR, errorMax: 3, errorMin: 3, errorLluvia: 6 },
    nueva: { dias: 2, errorMax: 0.1, errorMin: 0.1, errorLluvia: 0.1 },
  };
  const p = pesos(mucho, ['buena', 'mala', 'nueva']);
  assert.ok(p.temp.buena > p.temp.mala);
  assert.ok(p.lluvia.buena > p.lluvia.mala);
  // La nueva, con pocos días, no queda premiada por su error chico: recibe un peso del medio.
  assert.ok(p.temp.nueva <= p.temp.buena);
});

test('guarda una emisión por día y solo de los días siguientes', () => {
  const carpeta = mkdtempSync(path.join(os.tmpdir(), 'promclim-'));
  process.env.PROMCLIM_DATOS = carpeta;
  try {
    // Zona UTC+14: ahí ya son más de las 6 de la mañana casi siempre que corre el test.
    const zona = 'Pacific/Kiritimati';
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date());
    const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', hour12: false }).format(new Date()));
    const manana = new Date(`${hoy}T12:00:00Z`);
    manana.setUTCDate(manana.getUTCDate() + 1);
    const m = manana.toISOString().slice(0, 10);
    const lugar = { nombre: 'X', lat: -33.5, lon: -56.9, zona };
    const fuentes = [{ id: 'a', estado: 'ok', dias: [
      { fecha: hoy, max: 1, min: 1, lluvia: 1, prob: 50 }, { fecha: m, max: 20, min: 10, lluvia: 2, prob: 70 },
    ] }];

    const primera = registrarPronostico(lugar, fuentes, { _simple: [{ fecha: m, max: 20, min: 10, lluvia: 2 }] });
    const segunda = registrarPronostico(lugar, fuentes, {});
    if (hora < 6) return; // antes de las 6 no guarda: nada más que probar
    assert.equal(primera, true);
    assert.equal(segunda, false);
    const guardado = JSON.parse(readFileSync(path.join(carpeta, 'pronosticos.json'), 'utf8'))['-33.50,-56.90'];
    assert.deepEqual(guardado.emisiones[hoy].a, [{ fecha: m, max: 20, min: 10, lluvia: 2 }]);
    assert.ok(guardado.emisiones[hoy]._simple);
  } finally {
    delete process.env.PROMCLIM_DATOS;
    rmSync(carpeta, { recursive: true, force: true });
  }
});

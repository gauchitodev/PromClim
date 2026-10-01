// Lo que corre promclim-registrar.service: le pide a PromClim que guarde el
// pronóstico y las observaciones. Al prender la compu el temporizador puede
// dispararse antes de que haya internet, así que reintenta un rato.
const url = `http://127.0.0.1:${process.argv[2] || 8741}/api/registrar`;
const INTENTOS = 10;
const ESPERA_MS = 60_000;

for (let i = 1; i <= INTENTOS; i++) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    const texto = await r.text();
    if (r.ok) {
      console.log(texto);
      process.exit(0);
    }
    console.error(`Intento ${i}: ${texto}`);
  } catch (e) {
    console.error(`Intento ${i}: ${e.message}`);
  }
  if (i < INTENTOS) await new Promise((listo) => setTimeout(listo, ESPERA_MS));
}
process.exit(1);

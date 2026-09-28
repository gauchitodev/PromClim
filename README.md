# PromClim

Junta el pronóstico de varias fuentes del clima y muestra el promedio día por
día, con cuánto se separan entre sí y qué dijo cada una.

## Arrancar

```bash
npm start
```

Después abrí <http://localhost:8080>. No hace falta `npm install`: no usa
dependencias, solo Node 18 o más nuevo.

## Fuentes

| Fuente | Cómo se consigue | Qué aporta | Clave |
|---|---|---|---|
| Open-Meteo | API oficial gratis | 7 modelos (ECMWF, GFS, ICON, GEM, Météo-France, UKMO, JMA), 10 días | No |
| AccuWeather | API oficial | 5 días | Sí (gratis, 50 consultas por día) |
| Foreca | API oficial | 10 días | Sí (prueba de 30 días) |
| MetSul | JSON interno de su web | 10 días, sur de Sudamérica | No |
| INUMET | JSON interno de su web | 7 días, solo máxima y mínima, solo Uruguay (7 zonas) | No |

- Los 7 modelos de Open-Meteo se promedian entre sí y entran como **una sola
  fuente** al promedio general, para que no le ganen por cantidad a las demás.
- Si una fuente falla o no cubre el lugar, se saltea y el promedio sigue con
  las demás. En la pantalla se ve cuál entró y cuál no.
- **BoosterAgro** no está: su web vieja ya no anda (el servidor de la API no
  existe más) y la app del celular pide usuario. Para sumarla habría que
  estudiar cómo habla la app con su servidor.

## Claves de AccuWeather y Foreca

1. Copiá `config.ejemplo.json` a `config.local.json`. Ese archivo no se sube
   a git.
2. AccuWeather: creá una cuenta en <https://developer.accuweather.com>, creá
   una app y pegá la clave en `accuweather.clave`.
3. Foreca: pedí la prueba en <https://developer.foreca.com>, creá la clave en
   "My API" y pegala en `foreca.clave`.
4. Reiniciá el servidor. Al arrancar muestra qué fuentes quedaron activas.

## Cómo está armado

```
server.js              servidor HTTP + /api/buscar + /api/pronostico
lib/fuentes/*.js       una fuente por archivo, todas devuelven el mismo formato
lib/promedio.js        el promedio (media, mínimo, máximo y cuántas fuentes)
lib/util.js            fetch con timeout y caché en memoria
public/                la página (HTML, CSS y JS sin frameworks)
```

Cada fuente devuelve una lista de días `{ fecha, max, min, lluvia, prob,
viento }` con `null` donde no tiene el dato. Para sumar una fuente nueva se
copia un archivo de `lib/fuentes/` y se agrega a la lista `FUENTES` de
`server.js`.

Las respuestas se guardan en memoria un rato (Open-Meteo 30 min, MetSul 1 h,
INUMET 10 min, AccuWeather 3 h) para no molestar a las fuentes ni gastar las
consultas gratis.

## Para uso personal

PromClim está pensado para que cada uno lo corra en su propia compu, con sus
propias claves de AccuWeather y Foreca. No es para montarlo como página
pública: MetSul e INUMET no tienen API pública (se usan los mismos pedidos que
hacen sus páginas) y los planes gratis de AccuWeather y Foreca tienen límites
por clave. La app muestra de qué fuente sale cada dato, con enlace a cada una.

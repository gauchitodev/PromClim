<p align="center"><img src="docs/logo.svg" width="96" height="96" alt="Logo de PromClim: tres líneas que se juntan en una gota"></p>

# PromClim

Junta el pronóstico de varias fuentes del clima y muestra el promedio día por
día, con cuánto se separan entre sí y qué dijo cada una.

## Arrancar

```bash
npm start
```

Después abrí <http://localhost:8080>. No hace falta `npm install`: no usa
dependencias, solo Node 20 o más nuevo.

## Fuentes

**Sin clave** (andan apenas lo arrancás):

| Fuente | Qué aporta |
|---|---|
| Open-Meteo | 9 modelos: ECMWF, ECMWF AIFS (IA), GFS, ICON, GEM, Météo-France, UKMO, JMA y CMA. 10 días |
| Ensambles (Open-Meteo) | 143 escenarios de ECMWF, GFS, ICON y GEM. Da la probabilidad de lluvia y la lluvia promedio |
| MET Norway (yr.no) | Global, por hora los primeros días. Hoy no cuenta porque ya va empezado |
| MetSul | 10 días, sur de Sudamérica (JSON interno de su web) |
| INUMET | 7 días, solo máxima y mínima, solo Uruguay (JSON interno de su web) |
| wttr.in | 3 días, datos de World Weather Online |
| 7Timer! | 7 días, solo máxima y mínima (modelo GFS) |

**Con clave gratis** (se activan cuando ponés la clave en `config.local.json`):

| Fuente | Plan gratis | Dónde se saca |
|---|---|---|
| AccuWeather | 50 consultas por día, 5 días | <https://developer.accuweather.com> |
| Foreca | prueba de 30 días | <https://developer.foreca.com> |
| OpenWeatherMap | 5 días | <https://home.openweathermap.org/api_keys> |
| WeatherAPI.com | 3 días | <https://www.weatherapi.com/signup.aspx> |
| Visual Crossing | 1000 registros por día | <https://www.visualcrossing.com/sign-up> |

- Cada proveedor cuenta **una vez** en el promedio: los 9 modelos de Open-Meteo
  se promedian entre sí primero, para que no le ganen por cantidad a los demás.
- Varias fuentes usan por debajo los mismos modelos (por ejemplo, MET Norway
  usa ECMWF fuera de Europa y 7Timer usa GFS), así que no son del todo
  independientes.
- Si una fuente falla o no cubre el lugar, se saltea y el promedio sigue con
  las demás. En la pantalla se ve cuál entró y cuál no.
- **BoosterAgro** no está: su web vieja ya no anda y la app del celular pide
  usuario. **SMN Argentina** publica un pronóstico por estación en texto, pero
  sin coordenadas; quedó para más adelante.

## Día por día

Cada día se abre al tocarlo y muestra:

- cuántas fuentes dan lluvia, el rango de lluvia, máxima y mínima entre fuentes;
- dos gráficos hora por hora (temperatura y lluvia), del mejor modelo de
  Open-Meteo para el lugar; al pasar el dedo o el mouse se leen los valores de
  cada hora;
- una tabla con lo que dice cada fuente ese día.

## Lluvia

Para cada día: milímetros promedio, probabilidad promedio y cuántas fuentes
dan lluvia (1 mm o más). También la lluvia acumulada en 3 y 7 días, la del
promedio y la de cada fuente.

## Análisis con IA

El botón "Analizar" le pasa a una IA todo lo que dijo cada fuente y el
promedio, y te devuelve un resumen: lluvia, temperaturas, en qué no coinciden
las fuentes y algún consejo. Corre en tu compu con [Ollama](https://ollama.com):
gratis, sin cuentas ni claves, y los datos no salen de tu máquina.

```bash
# Arch Linux (en otros sistemas: https://ollama.com/download)
sudo pacman -S ollama
sudo systemctl enable --now ollama
ollama pull gemma3:4b      # unos 3 GB
```

Con otro modelo, cambiá `ia.modelo` en `config.local.json`. En una compu sin
placa de video, un modelo de 4B tarda más o menos un minuto en escribir el
análisis.

## Claves y configuración

1. Copiá `config.ejemplo.json` a `config.local.json`. Ese archivo no se sube
   a git.
2. Pegá las claves que tengas. Las que queden vacías se saltean.
3. Reiniciá el servidor. Al arrancar muestra qué fuentes quedaron activas.

## Cómo está armado

```
server.js              servidor HTTP + /api/buscar, /api/pronostico y /api/analisis
lib/fuentes/*.js       una fuente por archivo, todas devuelven el mismo formato
lib/promedio.js        el promedio (media, rango, cuántas fuentes) y la lluvia acumulada
lib/ia.js              arma el mensaje para la IA y habla con Ollama
lib/horario.js         hora por hora de Open-Meteo para el detalle de cada día
lib/util.js            fetch con timeout, caché en memoria y paso de horas a días
public/                la página (HTML, CSS y JS sin frameworks)
public/fuentes/        Roboto Flex y Material Symbols recortados, con sus licencias
```

Cada fuente devuelve una lista de días `{ fecha, max, min, lluvia, prob,
viento }` con `null` donde no tiene el dato. Para sumar una fuente nueva se
copia un archivo de `lib/fuentes/` y se agrega a la lista `FUENTES` de
`server.js`.

Las respuestas se guardan en memoria un rato (entre 10 minutos y 3 horas,
según la fuente) para no molestar a las fuentes ni gastar las consultas
gratis.

## Seguridad

PromClim no tiene usuarios ni contraseña, así que está armado para que solo lo
uses vos, desde tu compu:

- **Escucha solo en tu compu** (`127.0.0.1`). Otras compus de la red no llegan.
- **Otras páginas no lo pueden usar.** Si tenés abierta otra página en el
  navegador, no puede pedirle datos ni análisis a PromClim por atrás (se
  rechazan los pedidos que no vienen de la propia página, y los que llegan con
  otro nombre de servidor, para frenar el *DNS rebinding*).
- **La página no carga nada de afuera.** Las fuentes tipográficas vienen en el
  repo y la política de seguridad (CSP) no deja cargar scripts, estilos ni
  fuentes de otros sitios.
- **Las claves no salen de tu compu**: viven en `config.local.json` (fuera de
  git), las usa solo el servidor, y los mensajes de error nunca muestran las
  URLs que las llevan.
- **Límites**: un análisis de IA por vez (se corta si cerrás la página y a los
  5 minutos), respuestas de las fuentes de hasta 5 MB y memoria de caché con tope.

Si querés entrar desde el celular o desde otra compu de tu casa, poné en
`config.local.json` `"host": "0.0.0.0"` y en `"hostsPermitidos"` la dirección
con la que vas a entrar (por ejemplo `"192.168.1.20:8080"`). Tené en cuenta
que cualquiera en esa red va a poder usar tus claves y tu IA. No lo expongas a
internet.

Para reportar un problema de seguridad, mirá [SECURITY.md](SECURITY.md).

## Para uso personal

PromClim está pensado para que cada uno lo corra en su propia compu, con sus
propias claves. No es para montarlo como página
pública: MetSul e INUMET no tienen API pública (se usan los mismos pedidos que
hacen sus páginas) y los planes gratis de las APIs con clave tienen límites
por clave. La app muestra de qué fuente sale cada dato, con enlace a cada una.

## Íconos

Los íconos (Material Symbols) están recortados a los que usa la página, para
que pese 5 KB. Para sumar uno, agregalo a la lista y volvé a bajar el archivo:

```bash
ICONOS="ac_unit,air,auto_awesome,check_circle,cloud_off,error,expand_more,how_to_vote,location_on,my_location,partly_cloudy_day,remove_circle,search,table_chart,thermostat,travel_explore,umbrella,water_drop"
UA="Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0"
URL=$(curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&icon_names=$ICONOS" | grep -oE 'https://fonts.gstatic.com/[^)]+')
curl -s "$URL" -o public/fuentes/material-symbols-rounded.woff2
```

La lista tiene que ir en orden alfabético.

## Licencia

El código es [MIT](LICENSE) © 2026 Franco Feijó. Las fuentes tipográficas de
`public/fuentes/` tienen sus propias licencias: Roboto Flex (SIL OFL 1.1) y
Material Symbols (Apache 2.0), con los textos en esa misma carpeta. Los datos
del clima son de cada fuente y se rigen por sus condiciones.

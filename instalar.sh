#!/bin/sh
# Deja PromClim listo para usar como app (Linux con systemd):
# - el servidor arranca solo cuando abrís la app y se apaga solo sin uso;
# - aparece "PromClim" en el menú de aplicaciones.
# No pide sudo: todo queda en tu usuario. Para sacarlo: ./instalar.sh --quitar
set -eu

CARPETA=$(cd "$(dirname "$0")" && pwd)
UNIDADES="$HOME/.config/systemd/user"
APPS="$HOME/.local/share/applications"
ICONOS="$HOME/.local/share/icons/hicolor/scalable/apps"

if [ "${1:-}" = "--quitar" ]; then
  systemctl --user disable --now promclim-registrar.timer promclim.socket promclim.service 2>/dev/null || true
  rm -f "$UNIDADES/promclim.socket" "$UNIDADES/promclim.service" "$UNIDADES/promclim-registrar.service" \
        "$UNIDADES/promclim-registrar.timer" "$APPS/promclim.desktop" "$ICONOS/promclim.svg"
  systemctl --user daemon-reload
  echo "PromClim quitado del sistema (la carpeta y los datos de ~/.local/share/promclim quedan como están)."
  exit 0
fi

NODE=$(command -v node || true)
[ -n "$NODE" ] || { echo "Falta Node.js (20 o más nuevo)." >&2; exit 1; }
case "$CARPETA" in *[!A-Za-z0-9/._-]*)
  echo "La carpeta tiene espacios o caracteres raros: $CARPETA. Movela a una ruta simple." >&2; exit 1;;
esac

# El puerto sale de config.local.json si está, si no el de siempre.
PUERTO=$("$NODE" -e '
  try { const c = require(process.argv[1]); process.stdout.write(String(c.puerto || 8741)); }
  catch { process.stdout.write("8741"); }' "$CARPETA/config.local.json")
case "$PUERTO" in *[!0-9]*|"") echo "Puerto inválido en config.local.json" >&2; exit 1;; esac

if ss -ltnH "sport = :$PUERTO" 2>/dev/null | grep -q . && ! systemctl --user -q is-active promclim.socket; then
  echo "El puerto $PUERTO ya lo está usando otro programa. Cambiá \"puerto\" en config.local.json." >&2
  exit 1
fi

mkdir -p "$UNIDADES" "$APPS" "$ICONOS"
reemplazar() { sed -e "s|__CARPETA__|$CARPETA|g" -e "s|__NODE__|$NODE|g" -e "s|__PUERTO__|$PUERTO|g" "$1"; }
reemplazar "$CARPETA/sistema/promclim.socket"  > "$UNIDADES/promclim.socket"
reemplazar "$CARPETA/sistema/promclim.service" > "$UNIDADES/promclim.service"
reemplazar "$CARPETA/sistema/promclim-registrar.service" > "$UNIDADES/promclim-registrar.service"
reemplazar "$CARPETA/sistema/promclim-registrar.timer" > "$UNIDADES/promclim-registrar.timer"
reemplazar "$CARPETA/sistema/promclim.desktop" > "$APPS/promclim.desktop"
cp "$CARPETA/docs/logo.svg" "$ICONOS/promclim.svg"
chmod +x "$CARPETA/sistema/abrir.sh"

systemctl --user daemon-reload
systemctl --user enable --now promclim.socket
systemctl --user enable --now promclim-registrar.timer
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true

echo "Listo. Abrí \"PromClim\" desde el menú de aplicaciones, o entrá a http://localhost:$PUERTO"
echo "El servidor arranca solo al abrirlo y se apaga solo después de un rato sin uso."
echo "Dos veces por día guarda el pronóstico y lo que midieron las estaciones de INUMET (para ver quién acierta)."

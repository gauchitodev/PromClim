#!/bin/sh
# Abre PromClim en una ventana propia. Si el servidor no está corriendo,
# systemd lo prende solo al primer pedido (promclim.socket).
PUERTO="${PROMCLIM_PUERTO:-8741}"
URL="http://localhost:$PUERTO/"
systemctl --user start promclim.socket 2>/dev/null
for nav in chromium google-chrome-stable google-chrome brave; do
  if command -v "$nav" >/dev/null 2>&1; then
    exec "$nav" --app="$URL" --class=PromClim
  fi
done
exec xdg-open "$URL"

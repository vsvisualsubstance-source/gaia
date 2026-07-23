#!/bin/sh
# Accende/spegne davvero il display DSI. Serve perché su alcuni pannelli
# (Waveshare 4.3") bl_power non taglia la retroilluminazione: allora oltre a
# backlight/brightness si fa il blank della console E del framebuffer
# (schermo nero comunque). Il blank del solo framebuffer (fb0/blank) si è
# rivelato il pezzo mancante il 2026-07-23: con setterm/backlight soli il
# pannello restava visibile (contenuto residuo della VT), scritto diretto
# a fb0/blank risolve. Usato con prefisso "+" (root) da gaia-kiosk /
# gaia-screen / display-blank.
case "$1" in
  on)
    for d in /sys/class/backlight/*/; do
      [ -e "${d}bl_power" ] && echo 0 > "${d}bl_power" 2>/dev/null
      [ -e "${d}brightness" ] && cat "${d}max_brightness" > "${d}brightness" 2>/dev/null
    done
    [ -e /sys/class/graphics/fb0/blank ] && echo 0 > /sys/class/graphics/fb0/blank 2>/dev/null
    TERM=linux setterm --blank poke < /dev/tty1 > /dev/tty1 2>/dev/null
    ;;
  off)
    for d in /sys/class/backlight/*/; do
      [ -e "${d}bl_power" ] && echo 4 > "${d}bl_power" 2>/dev/null
      [ -e "${d}brightness" ] && echo 0 > "${d}brightness" 2>/dev/null
    done
    TERM=linux setterm --blank force < /dev/tty1 > /dev/tty1 2>/dev/null
    [ -e /sys/class/graphics/fb0/blank ] && echo 1 > /sys/class/graphics/fb0/blank 2>/dev/null
    # i messaggi kernel (es. undervoltage) ridisegnerebbero la console
    dmesg -n 1 2>/dev/null
    ;;
  *) echo "uso: $0 on|off"; exit 1 ;;
esac
exit 0

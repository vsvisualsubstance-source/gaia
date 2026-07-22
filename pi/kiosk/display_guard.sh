#!/bin/sh
# Ri-spegne il display DSI se kiosk e screen sono entrambi inattivi. Il
# display può "risvegliarsi" da solo (autologin su tty1 + qualsiasi cosa
# scriva sulla console — es. l'avvio/arresto di un altro servizio) anche
# dopo un blank esplicito: setterm --blank force è un blank puntuale, non
# uno stato persistente. Lanciato ogni minuto da gaia-display-guard.timer,
# si auto-corregge senza dover inseguire la causa esatta ogni volta.
if ! systemctl is-active --quiet gaia-kiosk && ! systemctl is-active --quiet gaia-screen; then
    /home/asemico/gaia/kiosk/display_power.sh off
fi

#!/bin/bash
# NetworkManager dispatcher: reinserisce la regola Docker -> LAN demo ogni volta
# che Gaia-Demo viene attivata (a boot o con `nmcli connection up Gaia-Demo`).
# NM ricrea la catena nm-sh-fw-<iface> ad ogni attivazione e la sua policy
# rifiuta il traffico dai container verso la LAN demo (mosquitto non raggiunge
# piu' i client) -- vedi docs/demo-portatile.md. Installato come
# /etc/NetworkManager/dispatcher.d/90-gaia-demo-fw (root:root, 755).
IFACE="$1"; ACTION="$2"
[ "$CONNECTION_ID" = "Gaia-Demo" ] || exit 0
case "$ACTION" in up|dhcp4-change|reapply) ;; *) exit 0 ;; esac

# In background: il dispatcher ha un timeout breve e la catena compare solo
# dopo che NM ha configurato la condivisione di rete.
(
  CHAIN="nm-sh-fw-$IFACE"
  for _ in $(seq 1 30); do
    iptables -n -L "$CHAIN" >/dev/null 2>&1 && break
    sleep 1
  done
  if ! iptables -n -L "$CHAIN" >/dev/null 2>&1; then
    logger -t gaia-demo-fw "catena $CHAIN non trovata, regola NON inserita"
    exit 0
  fi
  # "br-+" = tutti i bridge dei network compose (il nome br-<hash> cambia se la
  # rete Docker viene ricreata). In cima alla catena, prima dei REJECT.
  if ! iptables -C "$CHAIN" -i "br-+" -o "$IFACE" -j ACCEPT 2>/dev/null; then
    iptables -I "$CHAIN" 1 -i "br-+" -o "$IFACE" -j ACCEPT \
      && logger -t gaia-demo-fw "regola Docker->$IFACE inserita in $CHAIN"
  fi
) >/dev/null 2>&1 &
exit 0

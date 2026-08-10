# Rete di trasferta — Core come DHCP server (demo portatile)

Permette a Core, OPS, Pi e bridge Hue di viaggiare insieme (via cavo Ethernet
a uno switch non gestito, nessun router esterno, nessun internet) mantenendo
gli stessi IP che hanno a casa — così nessun IP hardcoded nel repo va
toccato. Dettagli/checklist complete in `docs/demo-portatile.md`.

## Setup (una volta sola, a casa)

1. Copiare la riservation DHCP al posto giusto:
   ```
   sudo cp gaia-demo-dnsmasq.conf /etc/NetworkManager/dnsmasq-shared.d/gaia-demo.conf
   ```
2. Creare il profilo NetworkManager dedicato su `enp0s31f6` (separato dal
   profilo di casa `netplan-enp0s31f6`, che resta intatto):
   ```
   sudo nmcli connection add \
     type ethernet ifname enp0s31f6 con-name Gaia-Demo \
     ipv4.method shared \
     ipv4.addresses 192.168.1.142/24 \
     connection.autoconnect no
   ```
   `ipv4.method shared` fa sì che NetworkManager avvii un dnsmasq interno
   sull'interfaccia, che legge automaticamente i file in
   `/etc/NetworkManager/dnsmasq-shared.d/` (incluso quello del punto 1).

## Il giorno della demo

```
sudo nmcli connection up Gaia-Demo
```

Verificare che OPS/Pi/bridge Hue prendano l'IP giusto (vedi checklist in
`docs/demo-portatile.md`).

## Al rientro a casa

```
sudo nmcli connection up netplan-enp0s31f6
```

Torna al DHCP-client verso il router di casa — nient'altro da disfare, il
profilo `Gaia-Demo` resta pronto (ma inattivo, `autoconnect no`) per la
prossima volta.

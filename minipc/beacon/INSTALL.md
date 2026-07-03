# GAIA Beacon — installazione (richiede sudo)

```bash
# 1. Servizio systemd
sudo cp /home/core/core-node-0/minipc/beacon/gaia-beacon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gaia-beacon

# 2. Annuncio mDNS (avahi ricarica da solo)
sudo cp /home/core/core-node-0/minipc/beacon/avahi-gaia.service /etc/avahi/services/gaia.service
```

Verifica:

```bash
systemctl status gaia-beacon
# Da un altro host della LAN:
python3 -c "
import socket, json
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
s.settimeout(3)
s.sendto(b'GAIA_DISCOVER', ('255.255.255.255', 8899))
print(json.loads(s.recvfrom(512)[0]))
"
avahi-browse -rt _gaia._tcp   # se avahi-utils installato
```

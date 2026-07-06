# Memory Index

- [Gaia Project Overview](project_gaia.md) — Architettura v1.0.2: miniPC + Pi (in produzione dietro NAT Google), discovery/beacon, provisioning, OTA-only deploy, MQTT topics
- [Gaia Web UI](project_gaia_web.md) — dashboard.html (WS stabile), admin.html (tab cfg+pi), pattern DOM, payload atteso
- [Tailscale VPN](reference_tailscale.md) — Via alternativa SSH/rsync verso Pi dietro NAT (tutti i device in tailnet)
- [OpenHAB Hue Items](project_openhab_items.md) — Mappa item OpenHAB reali, topic MQTT, REST API comandi, conversione Kelvin→%
- [Gaming/RPG](project_web_gaming_rpg.md) — motore XP VIVO dal 2026-07-04 (eventi→XP/livelli/archetipi), Engine Tick 3s, deploy flows via POST /flows, dettagli in docs/rpg-engine.md
- [Pensieri Profondi](project_pensieri_profondi.md) — pipeline Gaia Brain/Qdrant/Ollama, gap evoluzione linguistica trovato
- [Evoluzione Maggiordomo](project_maggiordomo.md) — automazioni proattive Node-RED, roadmap
- [Pet Recognition & Disability](project_pet_disability.md) — ATTENZIONE: output function non wired al 2026-07-03, verificare prima di fidarsi
- [ESP32/Arduino roadmap](project_esp32_roadmap.md) — piano fork del Pi, bassa priorità, non iniziato
- [TouchDesigner OSC bridge](project_touchdesigner_osc.md) — minipc/touchdesigner/, schema indirizzi, nota rate WS molto più alto del documentato
- [Automazioni](project_automazioni.md) — 11 automazioni nel toggle ufficiale, causa radice completa ingresso1 (retained MQTT), doppia conferma vocale welcome.html
- [Voce miniPC — GaiaWakeVerifier](project_voice_minipc.md) — modello allenato, gap TTS risposte risolto, bug taglio-comando risolto, modello medium
- [Architettura Core/OPS/Pi](project_architettura_core_ops.md) — split ruoli per contesa CPU; dal 2026-07-06 design N macchine (docs/core-distribuito.md) + moduli Pi futuri Herbarium/LiveStream (docs/pi-moduli-futuri.md)
- [Vocabolario Asemico](project_vocabolario_asemico.md) — lingua visiva deterministica (parola→glifo), asemic.js, v1 live su welcome, roadmap gesture/Pi-screen/gioco
- [Verifica Core su OPS](verifica-core-2026-07-06.md) — test end-to-end dal Core via SSH, carico ~46%/35GB, da unificare DEVICE_ID
- [Test stack visione OPS](ops-test-risultati.md) — esito Missione 2/3 silvermini2: fix DSHOW/model_asset_buffer, CAMERA_INDEX=4 (NDI su 0-3), carico, doppio camera_server tra sessioni

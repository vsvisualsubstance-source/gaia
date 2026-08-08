# Runtime status snapshot

This document is a low-risk observability note for the current runtime context.
It records what has been verified through HTTP probes and what is still only a
contract/documentation expectation.

## Current verified runtime

- Node-RED web UI: `http://192.168.1.240:1880/`
- Probing result observed: HTTP `200` at root path of the Node-RED HTTP static UI.
- Admin API endpoint: `http://192.168.1.240:8765/api/status`
- Observed result during the previous runtime review: timeout from the probe side.

## Repository/runtime distinction

The runtime is not presumed identical to the repository defaults:

- Legacy discovery and broker reference values still appear in docs (`192.168.1.142`)
- Runtime evidence points to `192.168.1.240` as the current OPS/HTTP host that serves web UI
- The admin API should remain a separate health signal; it is not guaranteed by HTTP static probes

## Tooling support

The helper script at `scripts/gaia_runtime_probe.py` performs an outbound HTTP smoke test
against the Node-RED base URL and a status API URL. The script intentionally never
starts/restarts services or rewrites configuration. It is only a read-only health probe.

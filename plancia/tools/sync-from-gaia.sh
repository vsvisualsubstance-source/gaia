#!/usr/bin/env bash
# Porta in plancia-next le correzioni fatte nel frattempo sulla Plancia in
# esercizio (cartella plancia/ del repo gaia). `git subtree split` e'
# deterministico: rigenera gli stessi commit gia' presenti qui, quindi il
# merge porta solo quelli nuovi.
#
#   tools/sync-from-gaia.sh /percorso/clone/di/gaia
#
# Il clone di gaia viene solo aggiornato (fetch) e gli si aggiunge un ramo
# locale "plancia-next-split"; nessun push verso gaia.
set -euo pipefail
GAIA=${1:?"percorso di un clone del repo gaia"}
git -C "$GAIA" fetch -q origin
git -C "$GAIA" subtree split --prefix=plancia origin/main -b plancia-next-split >/dev/null
git fetch -q "$GAIA" plancia-next-split
echo "Nuovi commit da gaia:"
git log --oneline HEAD..FETCH_HEAD || true
git merge --no-edit FETCH_HEAD

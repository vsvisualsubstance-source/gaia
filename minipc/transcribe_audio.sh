#!/bin/bash
# Wait up to 10s for the file to exist, then transcribe using the project's venv
FILE="$1"
for i in {1..10}; do
    if [ -s "$FILE" ]; then
        break
    fi
    sleep 1
done

# Use the project venv (symlinked to /media/core/D/venv). This keeps paths consistent.
PYTHON=/home/core/core-node-0/venv/bin/python3
if [ ! -x "$PYTHON" ]; then
    echo "Python interpreter not found: $PYTHON" >&2
    exit 2
fi

"$PYTHON" /home/core/core-node-0/script/transcribe.py "$FILE"

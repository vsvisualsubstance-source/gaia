#!/bin/bash
set -euo pipefail

TEXT="$*"

MODEL="/media/core/D/piper-voices/it_IT-paola-medium.onnx"
OUTPUT="/home/core/gaia_speech.wav"

PIPER="/usr/local/bin/piper"
PLAYER="/usr/bin/aplay"

LOG="/tmp/say_debug.log"

echo "===== SAY.SH DEBUG =====" > "$LOG"
echo "TEXT: $TEXT" >> "$LOG"
echo "LEN: ${#TEXT}" >> "$LOG"
echo "USER: $(whoami)" >> "$LOG"

# 🔥 GENERAZIONE CORRETTA PIPER
echo "$TEXT" | "$PIPER" \
  -m "$MODEL" \
  --output_file "$OUTPUT" >> "$LOG" 2>&1

# verifica file generato
ls -lh "$OUTPUT" >> "$LOG" 2>&1

# playback
"$PLAYER" "$OUTPUT" >> "$LOG" 2>&1

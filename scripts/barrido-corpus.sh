#!/bin/bash
# Barrido del corpus de exámenes: ejecuta el CLI sobre los 286 ficheros de
# /home/alumno/tmp/Evaluacion + Evaluacion2 y emite el fichero de baseline.
# Tarda ~2,5 min (un proceso de Node por fichero, cada uno carga el .wasm).
#
#   ./scripts/barrido-corpus.sh salida.txt "nota de cabecera"
#
# Compara con: diff <(grep -v '^#' viejo.txt) <(grep -v '^#' nuevo.txt)
set -u
cd "$(dirname "$0")/.."
SALIDA="${1:?uso: barrido-corpus.sh <salida.txt> [nota]}"
NOTA="${2:-}"
COMMIT=$(git rev-parse --short HEAD)
COMMIT_LARGO=$(git rev-parse HEAD)
TMP=$(mktemp)

find /home/alumno/tmp/Evaluacion /home/alumno/tmp/Evaluacion2 \
     \( -name '*.c' -o -name '*.cpp' \) | sort | while read -r f; do
  echo "### $f"
  node packages/cli/out/bin/check.js "$f" 2>/dev/null | grep '^  \[línea'
done > "$TMP"

TOTAL=$(grep -c '^  \[línea' "$TMP")
{
  echo "# Baseline de avisos de sclinter sobre el corpus de exámenes"
  echo "#"
  echo "# Generado: $(date +%Y-%m-%d)"
  echo "# Commit:   $COMMIT ($COMMIT_LARGO)"
  [ -n "$NOTA" ] && echo "#           $NOTA"
  echo "#"
  echo "# Corpus:   /home/alumno/tmp/Evaluacion + /home/alumno/tmp/Evaluacion2 (286 ficheros .c/.cpp)"
  echo "# Total:    $TOTAL avisos"
  echo "# Gramática: web-tree-sitter@0.24.4 + tree-sitter-cpp@0.23.4"
  echo "#"
  echo "# Desglose por regla:"
  sed -n 's/^  \[línea [0-9]*\] (\([^)]*\)).*/\1/p' "$TMP" | sort | uniq -c | sort -rn | sed 's/^/# /'
  cat "$TMP"
} > "$SALIDA"
rm -f "$TMP"
echo "Escrito $SALIDA — $TOTAL avisos"

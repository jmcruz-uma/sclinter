#!/bin/bash
# Barrido de un corpus de exámenes: ejecuta el CLI sobre sus ficheros .c/.cpp
# y emite el fichero de baseline. Tarda ~0,5 s por fichero (un proceso de Node
# por fichero, cada uno carga el .wasm): ~2,5 min para el corpus por defecto.
#
#   ./scripts/barrido-corpus.sh salida.txt "nota de cabecera" [dir...]
#
# Sin directorios usa el corpus por defecto (Evaluacion + Evaluacion2, 286
# ficheros), que es el que sigue el baseline de master.
#
# Compara con: diff <(grep -v '^#' viejo.txt) <(grep -v '^#' nuevo.txt)
set -u
cd "$(dirname "$0")/.."
SALIDA="${1:?uso: barrido-corpus.sh <salida.txt> [nota] [dir...]}"
NOTA="${2:-}"
shift 2 2>/dev/null || shift $#
if [ $# -eq 0 ]; then
  set -- /home/alumno/tmp/Evaluacion /home/alumno/tmp/Evaluacion2
fi
CORPUS="$*"
COMMIT=$(git rev-parse --short HEAD)
COMMIT_LARGO=$(git rev-parse HEAD)
TMP=$(mktemp)

find "$@" \( -name '*.c' -o -name '*.cpp' \) | sort | while read -r f; do
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
  echo "# Corpus:   $CORPUS ($(grep -c '^### ' "$TMP") ficheros .c/.cpp)"
  echo "# Total:    $TOTAL avisos"
  echo "# Gramática: web-tree-sitter@0.24.4 + tree-sitter-cpp@0.23.4"
  echo "#"
  echo "# Desglose por regla:"
  sed -n 's/^  \[línea [0-9]*\] (\([^)]*\)).*/\1/p' "$TMP" | sort | uniq -c | sort -rn | sed 's/^/# /'
  cat "$TMP"
} > "$SALIDA"
rm -f "$TMP"
echo "Escrito $SALIDA — $TOTAL avisos"

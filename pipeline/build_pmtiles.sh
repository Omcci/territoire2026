#!/usr/bin/env bash
# =============================================================================
# Territoires 2100 — Phase 1 : génération de l'archive PMTiles communale.
#
# Paradigme Cloud-Native Geospatial : PAS de serveur cartographique.
# Une seule archive PMTiles (tuiles vectorielles MVT) est déposée sur un
# stockage objet (S3 / Cloudflare R2) et lue par le client via des
# HTTP Range Requests (MapLibre GL JS + protocol pmtiles://).
#
# Contrat de données :
#   - Géométrie pure : contours communaux multi-échelles (Z0 -> Z12).
#   - Attributs STRICTEMENT limités à `code_insee` et `nom` (--include).
#   - Toutes les métriques vivent dans le GeoParquet partitionné ; la
#     jointure se fait côté client / DuckDB-WASM sur `code_insee`.
#
# Prérequis : tippecanoe >= 2.x  (macOS : `brew install tippecanoe`)
# Entrée    : data/geo/communes.geojson   (via `make gold`)
# Sortie    : data/geo/france_communes.pmtiles
#
# Usage : ./pipeline/build_pmtiles.sh [input.geojson] [output.pmtiles]
# =============================================================================
set -euo pipefail

INPUT="${1:-data/geo/communes.geojson}"
OUTPUT="${2:-data/geo/france_communes.pmtiles}"
LAYER="communes"
MIN_ZOOM="${MIN_ZOOM:-0}"
MAX_ZOOM="${MAX_ZOOM:-12}"

# --- Contrôles préalables --------------------------------------------------- #
if ! command -v tippecanoe >/dev/null 2>&1; then
  echo "ERREUR : tippecanoe introuvable. Installation : brew install tippecanoe (macOS) ou https://github.com/felt/tippecanoe" >&2
  exit 1
fi
if [[ ! -f "${INPUT}" ]]; then
  echo "ERREUR : ${INPUT} introuvable. Lancez d'abord : make gold" >&2
  exit 1
fi
mkdir -p "$(dirname "${OUTPUT}")"

echo "tippecanoe : $(tippecanoe --version 2>&1 | head -n 1)"
echo "Entrée     : ${INPUT} ($(du -h "${INPUT}" | cut -f1))"
echo "Sortie     : ${OUTPUT} (layer=${LAYER}, Z${MIN_ZOOM}-Z${MAX_ZOOM})"

# --- Génération PMTiles ----------------------------------------------------- #
# Options clés :
#   --include=code_insee --include=nom : contrat attributaire minimal, tout
#       autre attribut éventuel du GeoJSON source est écarté.
#   --detect-shared-borders : les frontières communales partagées sont
#       simplifiées de façon cohérente (pas de "trous" entre communes).
#   --simplification=4 + --simplify-only-low-zooms : simplification dynamique
#       forte aux petits zooms, géométrie pleine résolution à Z12.
#   --drop-densest-as-needed + --extend-zooms-if-still-dropping :
#       si une tuile dépasse le budget, on élague les polygones les plus
#       denses plutôt que de tronquer arbitrairement ; le zoom max est
#       relevé automatiquement si l'élagage persiste.
#   --coalesce-densest-as-needed : fusionne les plus petits polygones
#       voisins aux faibles zooms pour préserver la lisibilité.
#   --no-tiny-polygon-reduction-at-maximum-zoom : à Z12, aucune commune
#       ne disparaît (chaque code_insee doit rester interrogeable).
#   --buffer=64 : marge de clipping généreuse, coutures invisibles.
tippecanoe \
  --output="${OUTPUT}" \
  --force \
  --name="Territoires 2100 — Communes de France" \
  --description="Contours communaux français (géométrie pure). Métriques : GeoParquet partitionné, jointure sur code_insee." \
  --attribution="Territoires 2100 (données de démonstration synthétiques) — IGN Admin Express en production" \
  --layer="${LAYER}" \
  --include=code_insee \
  --include=nom \
  --minimum-zoom="${MIN_ZOOM}" \
  --maximum-zoom="${MAX_ZOOM}" \
  --detect-shared-borders \
  --simplification=4 \
  --simplify-only-low-zooms \
  --no-tiny-polygon-reduction-at-maximum-zoom \
  --drop-densest-as-needed \
  --coalesce-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --buffer=64 \
  --read-parallel \
  "${INPUT}"

# --- Vérification post-génération ------------------------------------------- #
if [[ ! -s "${OUTPUT}" ]]; then
  echo "ERREUR : ${OUTPUT} n'a pas été généré." >&2
  exit 1
fi
MAGIC="$(head -c 7 "${OUTPUT}")"
if [[ "${MAGIC}" != "PMTiles" ]]; then
  echo "ERREUR : en-tête PMTiles invalide (${MAGIC})." >&2
  exit 1
fi

echo ""
echo "OK — archive PMTiles générée :"
ls -lh "${OUTPUT}"
echo "Vérification rapide (tuile 0/0/0) :"
tippecanoe-decode "${OUTPUT}" 0 0 0 >/dev/null 2>&1 && echo "  tippecanoe-decode 0/0/0 : OK" || echo "  tippecanoe-decode indisponible pour ce contrôle (non bloquant)"
echo ""
echo "Publication (exemple) :"
echo "  aws s3 cp ${OUTPUT} s3://territoires-2100/geo/france_communes.pmtiles --content-type application/octet-stream"
echo "  # ou : rclone copy ${OUTPUT} r2:territoires-2100/geo/"

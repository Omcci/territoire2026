#!/usr/bin/env python3
"""Reconstruit le référentiel communal du projet à partir des VRAIES
géométries communales déjà présentes dans le dépôt
(`public/data/geo/communes.geojson`, contours Etalab/IGN simplifiés :
codes INSEE et noms officiels, centroïdes réels).

Remplace l'ancien référentiel synthétique (codes séquentiels, noms et
coordonnées inventés par `pipeline/generate_gold_data.py`), qui rendait
la sélection incohérente : la fiche et la caméra utilisaient des
coordonnées sans rapport avec le polygone cliqué.

Produits :
- `data/geo/communes.geojson`          : géométries réelles (entrée tippecanoe).
- `data/geo/communes_reference.parquet`: même schéma qu'avant (16 colonnes),
  nom/département/centroïde réels ; covariables environnementales
  synthétiques (démonstration) recalculées par les fonctions du
  générateur d'origine sur les centroïdes réels.
- `data/metrics/scenario=*/indicator={rga,heatwave,flooding,water_stress}.parquet`
  : partitions climatiques synthétiques régénérées sur les codes réels
  (mêmes formules que le générateur d'origine).
- `data/geo/reference_manifest.json`   : effectifs + communes témoins
  (utilisé par les tests d'intégrité géographique).

Périmètre : France métropolitaine + Corse (départements présents dans
`public/data/geo/departements.geojson`). Paris est la commune 75056.
"""
import json
import sys
from pathlib import Path

import numpy as np
import polars as pl
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.generate_gold_data import (  # noqa: E402
    PIVOT_YEARS,
    compute_covariates,
    exposure_vulnerability,
    write_metrics,
)

SRC_COMMUNES = ROOT / "public/data/geo/communes.geojson"
SRC_DEPTS = ROOT / "public/data/geo/departements.geojson"
OUT_GEOJSON = ROOT / "data/geo/communes.geojson"
OUT_REF = ROOT / "data/geo/communes_reference.parquet"
OUT_MANIFEST = ROOT / "data/geo/reference_manifest.json"
METRICS_DIR = ROOT / "data/metrics"

TEST_CODES = ["92024", "93055", "33063", "75056", "93066", "69123", "13055"]
# Clichy, Pantin, Bordeaux, Paris, Saint-Denis, Lyon, Marseille


def dept_of(code: str) -> str:
    return code[:2]


def main() -> None:
    dept_codes = {
        f["properties"]["code"]
        for f in json.loads(SRC_DEPTS.read_text(encoding="utf-8"))["features"]
    }
    source = json.loads(SRC_COMMUNES.read_text(encoding="utf-8"))

    kept: list[dict] = []
    sans_geometrie = 0
    for feature in source["features"]:
        props = feature.get("properties") or {}
        code = props.get("code_insee") or props.get("code")
        if not code or dept_of(code) not in dept_codes:
            continue
        if not feature.get("geometry"):
            sans_geometrie += 1
            continue
        kept.append({
            "code": code,
            "nom": props.get("nom") or code,
            "geometry": feature["geometry"],
        })
    kept.sort(key=lambda item: item["code"])
    print(f"communes réelles retenues (métropole + Corse) : {len(kept)}"
          f" (sans géométrie, exclues : {sans_geometrie})")

    # --- GeoJSON tippecanoe (propriétés strictement code_insee + nom) ---
    OUT_GEOJSON.write_text(json.dumps({
        "type": "FeatureCollection",
        "name": "france_communes",
        "features": [
            {
                "type": "Feature",
                "properties": {"code_insee": item["code"], "nom": item["nom"]},
                "geometry": item["geometry"],
            }
            for item in kept
        ],
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  -> {OUT_GEOJSON.relative_to(ROOT)}")

    # --- Référence : centroïdes réels du polygone cliqué ---
    centroids = [shape(item["geometry"]).centroid for item in kept]
    lon = np.array([c.x for c in centroids], dtype=np.float64)
    lat = np.array([c.y for c in centroids], dtype=np.float64)
    codes = [item["code"] for item in kept]

    rng = np.random.default_rng(42)
    cov = compute_covariates(lon, lat, rng)
    exposure, vulnerability = exposure_vulnerability(cov, lat, lon, rng)

    ref = pl.DataFrame({
        "code_insee": pl.Series("code_insee", codes).cast(pl.Categorical),
        "nom": [item["nom"] for item in kept],
        "dept": [dept_of(code) for code in codes],
        "lon": lon.astype(np.float32),
        "lat": lat.astype(np.float32),
        "altitude_m": cov["altitude_m"].astype(np.float32),
        "slope_deg": cov["slope_deg"].astype(np.float32),
        "roughness_m": cov["roughness_m"].astype(np.float32),
        "dist_coast_km": cov["dist_coast_km"].astype(np.float32),
        "dist_river_km": cov["dist_river_km"].astype(np.float32),
        "clay_index": cov["clay_index"].astype(np.float32),
        "urban_index": cov["urban_index"].astype(np.float32),
        "canopy_pct": cov["canopy_pct"].astype(np.float32),
        "impervious_pct": cov["impervious_pct"].astype(np.float32),
        "exposure_score": exposure.astype(np.float32),
        "vulnerability_score": vulnerability.astype(np.float32),
    }).sort("code_insee")
    ref.write_parquet(OUT_REF, compression="zstd", compression_level=3, statistics=True)
    print(f"  -> {OUT_REF.relative_to(ROOT)} ({len(ref)} lignes)")

    # --- Partitions climatiques synthétiques sur codes réels ---
    communes = {"code_insee": codes, "lon": lon, "lat": lat}
    written = write_metrics(communes, cov, exposure, vulnerability, PIVOT_YEARS, METRICS_DIR, rng)
    print(f"  -> {len(written)} partitions climatiques régénérées")

    # --- Manifeste pour les tests d'intégrité ---
    by_code = {item["code"]: item for item in kept}
    manifest = {
        "source": "public/data/geo/communes.geojson (contours Etalab/IGN simplifiés)",
        "perimetre": "France métropolitaine + Corse",
        "communes": len(kept),
        "temoins": {
            code: {
                "nom": by_code[code]["nom"],
                "lon": round(float(shape(by_code[code]["geometry"]).centroid.x), 5),
                "lat": round(float(shape(by_code[code]["geometry"]).centroid.y), 5),
                # Point garanti intérieur au polygone (tests de clic).
                "point": [
                    round(float(shape(by_code[code]["geometry"]).point_on_surface().x), 5),
                    round(float(shape(by_code[code]["geometry"]).point_on_surface().y), 5),
                ],
            }
            for code in TEST_CODES
        },
    }
    OUT_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  -> {OUT_MANIFEST.relative_to(ROOT)} : {json.dumps(manifest['temoins'], ensure_ascii=False)}")


if __name__ == "__main__":
    main()

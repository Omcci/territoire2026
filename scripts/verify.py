#!/usr/bin/env python3.11
"""
Territoires 2100 — vérification bout-en-bout de la Phase 1.

Contrôle les trois artefacts livrés, exactement comme les consommeront les
clients (DuckDB / navigateur) :

1. GeoParquet partitionné : lecture DuckDB ``read_parquet(..., hive_partitioning)``,
   contrôle du schéma contractuel et requête "top risque 2050 / SSP5-8.5".
2. PMTiles : présence + en-tête de l'archive ``france_communes.pmtiles``.
3. ONNX : inférence ``downscaler_france.onnx`` via onnxruntime sur les
   35 000 centroïdes communaux (preuve du scoring côté client, sans sklearn).

Usage : .venv/bin/python scripts/verify.py   (ou `make verify`)
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

EXPECTED_SCHEMA = {
    "code_insee": "VARCHAR",
    "year": "SMALLINT",
    "hazard_raw": "FLOAT",
    "hazard_local_100m": "FLOAT",
    "exposure_score": "FLOAT",
    "vulnerability_score": "FLOAT",
    "composite_risk_score": "FLOAT",
}


def check_geoparquet() -> None:
    import duckdb

    pattern = (ROOT / "data" / "metrics" / "**" / "*.parquet").as_posix()
    con = duckdb.connect()
    schema = con.execute(
        f"DESCRIBE SELECT * FROM read_parquet('{pattern}', hive_partitioning=true) LIMIT 0"
    ).fetchall()
    got = {row[0]: row[1] for row in schema}
    for col, typ in EXPECTED_SCHEMA.items():
        assert col in got, f"Colonne manquante : {col}"
        assert got[col] == typ, f"{col} : type {got[col]} != attendu {typ}"
    assert "scenario" in got, "Partition Hive `scenario` non détectée"
    print(f"[OK] GeoParquet — schéma contractuel vérifié ({len(got)} colonnes, dont partition scenario={got['scenario']})")

    n, n_communes = con.execute(
        f"SELECT count(*), count(DISTINCT code_insee) FROM read_parquet('{pattern}', hive_partitioning=true)"
    ).fetchone()
    print(f"[OK] GeoParquet — {n:,} lignes, {n_communes:,} communes")

    # NB : on sélectionne l'indicateur par le chemin du fichier plutôt que par
    # la colonne virtuelle `filename`, dont la combinaison avec
    # hive_partitioning déclenche un bug interne de DuckDB 2.0.
    heatwave_2050 = (ROOT / "data" / "metrics" / "scenario=ssp585" / "indicator=heatwave.parquet").as_posix()
    rows = con.execute(
        f"""
        SELECT code_insee, round(composite_risk_score, 3) AS risk
        FROM read_parquet('{heatwave_2050}', hive_partitioning=true)
        WHERE year = 2050
        ORDER BY composite_risk_score DESC LIMIT 5
        """
    ).fetchall()
    print("[OK] DuckDB — top 5 risque composite canicule 2050 (SSP5-8.5) :")
    for code, risk in rows:
        print(f"       {code}  composite={risk}")


def check_pmtiles() -> None:
    path = ROOT / "data" / "geo" / "france_communes.pmtiles"
    assert path.exists() and path.stat().st_size > 0, "france_communes.pmtiles manquant (make pmtiles)"
    assert path.read_bytes()[:7] == b"PMTiles", "En-tête PMTiles invalide"
    print(f"[OK] PMTiles — france_communes.pmtiles ({path.stat().st_size / 1e6:.1f} Mo, en-tête valide)")


def check_onnx() -> None:
    import onnxruntime as ort
    import polars as pl

    onnx_path = ROOT / "models" / "downscaler_france.onnx"
    ref_path = ROOT / "data" / "geo" / "communes_reference.parquet"
    assert onnx_path.exists(), "downscaler_france.onnx manquant (make train)"

    ref = pl.read_parquet(ref_path).sort("code_insee")
    lon, lat = ref["lon"].to_numpy(), ref["lat"].to_numpy()
    alt = ref["altitude_m"].to_numpy()
    # Aléa régional 8 km reconstruit comme à l'entraînement (maille 0,08°).
    lon_g = np.round(lon / 0.08) * 0.08
    lat_g = np.round(lat / 0.08) * 0.08
    alt_reg = np.clip(
        90
        + 2900 * np.exp(-(((lon_g - 6.6) ** 2 + (lat_g - 45.9) ** 2) / (2 * 0.85**2)))
        + 2100 * np.exp(-(((lon_g - 0.8) ** 2 + (lat_g - 42.7) ** 2) / (2 * 0.7**2)))
        + 1300 * np.exp(-(((lon_g - 3.6) ** 2 + (lat_g - 45.1) ** 2) / (2 * 0.9**2))),
        0, 4200,
    )
    hazard_regional = 35.6 - 0.82 * (lat_g - 42.3) - 0.0058 * alt_reg + 0.9 * np.sin(lon_g * 1.7 + 0.4) * np.cos(lat_g * 1.3)
    X = np.column_stack(
        [
            hazard_regional, alt, ref["slope_deg"].to_numpy(), ref["dist_river_km"].to_numpy(),
            ref["roughness_m"].to_numpy(), ref["dist_coast_km"].to_numpy(),
            ref["impervious_pct"].to_numpy(), ref["canopy_pct"].to_numpy(),
        ]
    ).astype(np.float32)

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    pred = session.run(None, {session.get_inputs()[0].name: X})[0].ravel()
    order = np.argsort(-pred)[:5]
    print(f"[OK] ONNX — inférence sur {len(pred):,} communes (T locale prédite : {pred.min():.1f} … {pred.max():.1f} °C)")
    print("     Communes les plus chaudes après downscaling 100 m :")
    codes, noms = ref["code_insee"].to_list(), ref["nom"].to_list()
    for i in order:
        print(f"       {codes[i]} {noms[i]:<28s} {pred[i]:.1f} °C")


def main() -> int:
    print("Territoires 2100 — vérification Phase 1\n" + "-" * 44)
    check_geoparquet()
    check_pmtiles()
    check_onnx()
    print("-" * 44 + "\nPhase 1 : tous les contrôles passent. ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())

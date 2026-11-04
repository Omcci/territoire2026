#!/usr/bin/env python3
"""Génère public/data/geo/regions.geojson par union des départements.

Source : public/data/geo/departements.geojson (référentiel du projet).
Correspondance département -> région : découpage administratif officiel
(régions métropolitaines). Aucune donnée inventée : simple agrégation
géométrique des polygones départementaux existants.
"""
import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public/data/geo/departements.geojson"
DST = ROOT / "public/data/geo/regions.geojson"

REGIONS: dict[str, tuple[str, list[str]]] = {
    "11": ("Île-de-France", ["75", "77", "78", "91", "92", "93", "94", "95"]),
    "24": ("Centre-Val de Loire", ["18", "28", "36", "37", "41", "45"]),
    "27": ("Bourgogne-Franche-Comté", ["21", "25", "39", "58", "70", "71", "89", "90"]),
    "28": ("Normandie", ["14", "27", "50", "61", "76"]),
    "32": ("Hauts-de-France", ["02", "59", "60", "62", "80"]),
    "44": ("Grand Est", ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"]),
    "52": ("Pays de la Loire", ["44", "49", "53", "72", "85"]),
    "53": ("Bretagne", ["22", "29", "35", "56"]),
    "75": ("Nouvelle-Aquitaine", ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"]),
    "76": ("Occitanie", ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"]),
    "84": ("Auvergne-Rhône-Alpes", ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"]),
    "93": ("Provence-Alpes-Côte d'Azur", ["04", "05", "06", "13", "83", "84"]),
    "94": ("Corse", ["2A", "2B"]),
}


def main() -> None:
    source = json.loads(SRC.read_text(encoding="utf-8"))
    by_dept = {f["properties"]["code"]: shape(f["geometry"]) for f in source["features"]}
    features = []
    for code, (nom, depts) in REGIONS.items():
        geoms = [by_dept[d] for d in depts if d in by_dept]
        if not geoms:
            continue
        union = unary_union(geoms)
        features.append({
            "type": "Feature",
            "id": code,
            "properties": {"code": code, "nom": nom, "departements": [d for d in depts if d in by_dept]},
            "geometry": mapping(union),
        })
    DST.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False), encoding="utf-8")
    print(f"regions.geojson : {len(features)} régions -> {DST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Télécharge les VRAIS contours administratifs français (Etalab / IGN,
dépôt gregoiredavid/france-geojson, versions simplifiées pour le web)
et les normalise pour Territoires 2100 :

- departements.geojson : ajoute `dept` (= code) attendu par la carte.
- communes.geojson     : ajoute `code_insee` (= code), jointure métriques.
- regions.geojson      : tel quel.

Les polygones sont jointifs et clippés aux côtes/frontières : rien ne
déborde hors de France, contrairement aux anciennes géométries synthétiques.
"""
import json
import os
import urllib.request

BASE = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master"
OUT_DIR = "public/data/geo"
os.makedirs(OUT_DIR, exist_ok=True)


def download(name: str) -> str:
    path = os.path.join(OUT_DIR, name)
    print(f"Téléchargement {name}...")
    urllib.request.urlretrieve(f"{BASE}/{name}", path)
    return path


def normalize(path: str, source_key: str, target_key: str) -> None:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        if source_key in props:
            props[target_key] = props[source_key]
        feature["properties"] = props
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  normalisé : {len(data.get('features', []))} entités, +{target_key}")


def main() -> None:
    dept = download("departements-version-simplifiee.geojson")
    os.replace(dept, os.path.join(OUT_DIR, "departements.geojson"))
    normalize(os.path.join(OUT_DIR, "departements.geojson"), "code", "dept")

    regions = download("regions-version-simplifiee.geojson")
    os.replace(regions, os.path.join(OUT_DIR, "regions.geojson"))

    communes = download("communes-version-simplifiee.geojson")
    os.replace(communes, os.path.join(OUT_DIR, "communes.geojson"))
    normalize(os.path.join(OUT_DIR, "communes.geojson"), "code", "code_insee")

    print("OK : Vrais contours administratifs téléchargés.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Pipeline reproductible — indicateur « Mémoire des catastrophes » (catnat).

Source OBSERVÉE : base nationale GASPAR (Ministère de la Transition
écologique, Géorisques), fichier catnat_gaspar_*.csv de l'archive
officielle https://files.georisques.fr/GASPAR/gaspar.zip
(licence Licence Ouverte / fr-lo, voir data.gouv.fr « Base nationale de
Gestion ASsistée des Procédures Administratives relatives aux risques »).

Données d'entrée attendues : data/sources/gaspar.zip (téléchargement
manuel, ~8 Mo, vérifié le 2026-11-04 : Content-Length 8128549).

Méthode (dérivée, documentée — aucune valeur inventée) :
- Un arrêté = une ligne du CSV (reconnaissance de l'état de catastrophe
  naturelle pour une commune et un événement daté).
- hazard (raw et local) = nombre cumulé d'arrêtés dont l'événement a
  commencé avant la fin de l'année pivot (1990, puis 2025).
- Les pivots 2050 et 2100 reprennent le cumul 2025 : les données sont
  observées, il n'existe AUCUNE projection. Le plateau est volontaire
  et documenté dans les métadonnées du récit.
- composite_risk_score = min(cumul_2025, 25) / 25 (échelle dérivée,
  linéaire, plafonnée à 25 arrêtés et plus).
- exposure_score et vulnerability_score = composite (dérivés ; ils ne
  mesurent ni le bâti ni la population, faute de source jointe à ce
  stade — voir limites dans catnat_metadata.json).

Sorties : data/metrics/scenario={ssp126,ssp245,ssp585}/indicator=catnat.parquet
(les trois scénarios portent les mêmes valeurs observées : la trajectoire
d'émissions ne s'applique pas au passé observé) et
data/metrics/catnat_metadata.json.

Usage : .venv/bin/python scripts/build_catnat_partitions.py
"""

import json
import zipfile
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
ZIP_PATH = ROOT / "data" / "sources" / "gaspar.zip"
REF_PATH = ROOT / "data" / "geo" / "communes_reference.parquet"
OUT_DIR = ROOT / "data" / "metrics"
CAP = 25  # plafond de l'échelle composite (arrêtés cumulés)


def main() -> None:
    if not ZIP_PATH.exists():
        raise SystemExit(
            f"Archive absente : {ZIP_PATH}. Téléchargez "
            "https://files.georisques.fr/GASPAR/gaspar.zip (~8 Mo, Licence Ouverte)."
        )
    with zipfile.ZipFile(ZIP_PATH) as z:
        names = [n for n in z.namelist() if n.startswith("catnat_gaspar_")]
        if not names:
            raise SystemExit("Aucun fichier catnat_gaspar_*.csv dans l'archive GASPAR.")
        csv_name = names[0]
        csv_bytes = z.read(csv_name)

    tmp_csv = ROOT / "data" / "sources" / "_catnat_extract.csv"
    tmp_csv.write_bytes(csv_bytes)
    try:
        con = duckdb.connect()
        con.execute(
            """
            CREATE TEMP TABLE arretes AS
            SELECT
              -- Paris : code communal officiel 75056 (référentiel réel).
              code_commune AS code_insee,
              year(try_strptime(date_debut, '%Y-%m-%d %H:%M:%S')) AS annee
            FROM read_csv(?, header = true, sep = ';', columns = {
              'id_gaspar': 'VARCHAR', 'code_commune': 'VARCHAR',
              'libelle_commune': 'VARCHAR', 'num_risque_jo': 'VARCHAR',
              'lib_risque_jo': 'VARCHAR', 'date_debut': 'VARCHAR',
              'date_fin': 'VARCHAR', 'date_signature_arrete': 'VARCHAR',
              'date_publication_jo': 'VARCHAR', 'date_modification': 'VARCHAR'
            })
            WHERE code_commune IS NOT NULL AND annee IS NOT NULL
            """,
            [str(tmp_csv)],
        )

        stats = con.execute(
            """
            SELECT
              (SELECT count(*) FROM arretes) AS arretes_total,
              (SELECT count(DISTINCT code_insee) FROM arretes) AS communes_touchees,
              (SELECT count(*) FROM (SELECT code_insee FROM arretes GROUP BY 1 HAVING count(*) >= 10)) AS communes_10plus,
              (SELECT max(n) FROM (SELECT count(*) AS n FROM arretes GROUP BY code_insee)) AS max_commune,
              (SELECT min(annee) FROM arretes) AS annee_min,
              (SELECT max(annee) FROM arretes) AS annee_max
            """
        ).fetchone()
        print("Statistiques GASPAR :", stats)

        for scenario in ("ssp126", "ssp245", "ssp585"):
            out = OUT_DIR / f"scenario={scenario}" / "indicator=catnat.parquet"
            con.execute(
                """
                COPY (
                  WITH cumuls AS (
                    SELECT
                      ref.code_insee,
                      coalesce(sum(CASE WHEN a.annee <= 1990 THEN 1 ELSE 0 END), 0) AS c1990,
                      coalesce(sum(CASE WHEN a.annee <= 2025 THEN 1 ELSE 0 END), 0) AS c2025
                    FROM read_parquet(?) ref
                    LEFT JOIN arretes a ON a.code_insee = ref.code_insee
                    GROUP BY ref.code_insee
                  ),
                  lignes AS (
                    SELECT code_insee, 1990 AS year, c1990 AS cumul FROM cumuls
                    UNION ALL SELECT code_insee, 2025, c2025 FROM cumuls
                    UNION ALL SELECT code_insee, 2050, c2025 FROM cumuls
                    UNION ALL SELECT code_insee, 2100, c2025 FROM cumuls
                  )
                  SELECT
                    code_insee,
                    year::SMALLINT AS year,
                    cumul::FLOAT AS hazard_raw,
                    cumul::FLOAT AS hazard_local_100m,
                    least(c2025, ?)::FLOAT / ? AS exposure_score,
                    least(c2025, ?)::FLOAT / ? AS vulnerability_score,
                    least(cumul, ?)::FLOAT / ? AS composite_risk_score,
                    ?::VARCHAR AS scenario
                  FROM lignes JOIN cumuls USING (code_insee)
                  ORDER BY code_insee, year
                ) TO ? (FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL 3)
                """,
                [
                    str(REF_PATH),
                    CAP, CAP, CAP, CAP, CAP, CAP,
                    scenario,
                    str(out),
                ],
            )
            n = con.execute("SELECT count(*) FROM read_parquet(?)", [str(out)]).fetchone()[0]
            print(f"{out.relative_to(ROOT)} : {n} lignes")
    finally:
        tmp_csv.unlink(missing_ok=True)

    metadata = {
        "indicator": "catnat",
        "label": "Mémoire des catastrophes",
        "data_nature": "observed",
        "derived": True,
        "source": {
            "name": "Base nationale GASPAR — arrêtés de catastrophe naturelle",
            "publisher": "Ministère de la Transition écologique (Géorisques)",
            "dataset": "Base nationale de Gestion ASsistée des Procédures Administratives relatives aux risques (GASPAR)",
            "archive": "https://files.georisques.fr/GASPAR/gaspar.zip",
            "file": csv_name,
            "license": "Licence Ouverte (fr-lo)",
            "retrieved": "2026-11-04",
        },
        "method": {
            "hazard": "Nombre cumulé d'arrêtés CatNat par commune (événements commencés avant fin 1990, puis fin 2025).",
            "composite": f"min(cumul, {CAP}) / {CAP} — échelle dérivée linéaire plafonnée.",
            "pivots_2050_2100": "Plateau au cumul 2025 : données observées, aucune projection.",
            "scenarios": "Les trois partitions portent les mêmes valeurs : la trajectoire d'émissions ne s'applique pas au passé observé.",
        },
        "statistics": {
            "arretes_total": stats[0],
            "communes_with_at_least_one": stats[1],
            "communes_with_10_or_more": stats[2],
            "max_per_commune": stats[3],
            "event_year_min": stats[4],
            "event_year_max": stats[5],
        },
        "limitations": [
            "Un arrêté est une reconnaissance administrative, pas une mesure physique de l'aléa : il dépend des demandes des communes et des critères d'éligibilité.",
            "Les arrêtés sécheresse (retrait-gonflement des argiles) dominent les volumes récents ; la mémoire affichée mélange tous les périls reconnus.",
            "exposure_score et vulnerability_score sont dérivés du même comptage : ils ne mesurent ni le bâti ni la population exposée.",
            "Aucune projection au-delà de 2025 : les horizons 2050 et 2100 affichent le passé observé, pas un futur.",
        ],
        "pipeline": "scripts/build_catnat_partitions.py",
    }
    (OUT_DIR / "catnat_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Métadonnées :", OUT_DIR / "catnat_metadata.json")


if __name__ == "__main__":
    main()

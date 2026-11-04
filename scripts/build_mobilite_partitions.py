#!/usr/bin/env python3
"""
Pipeline reproductible — récit « Peut-on vivre sans voiture ? » (Phase F).

Sources OBSERVÉES : INSEE, recensement de la population 2023,
« principaux indicateurs » du dossier complet diffusés via l'API
Melodi de l'INSEE (data.gouv.fr, Licence Ouverte 2.0) :
- DS_RP_LOGEMENT_PRINC_2023 (ménages selon l'équipement automobile,
  dimension CARS : C_GE1 = au moins une voiture, _T = total) ;
- DS_RP_NAVETTES_PRINC_2023 (actifs occupés de 15 ans ou plus selon
  le mode de transport principal domicile-travail, dimension TRANS :
  5 = voiture, 6 = transports en commun, _T = total).
Fichiers attendus (archives ZIP malgré l'extension .csv) :
data/sources/rp/DS_RP_LOGEMENT_PRINC_2023.csv (98 Mo) et
data/sources/rp/DS_RP_NAVETTES_PRINC_2023.csv (12 Mo), téléchargés le
2026-11-04 depuis https://api.insee.fr/melodi/file/... (voir en-tête).

Ne pas confondre (le récit le dit) :
- possession d'une voiture (ménages équipés) ;
- usage pour aller travailler (mode principal déclaré des actifs) ;
- absence d'alternative, distance ou temps de trajet : non mesurés.

Indicateurs (parts en % des effectifs de la commune de résidence) :
- voiture_menages : ménages disposant d'au moins une voiture ;
- voiture_travail : actifs occupés allant travailler en voiture ;
- transports_communs : actifs occupés allant travailler en transports
  en commun.
composite = part / 100 ; hazard = part en %. Fiabilité : en dessous
de 30 ménages (ou 30 actifs), la part est remplacée par la sentinelle
-1 « non établi » (recensement par sondage tournant : les petits
effectifs communaux sont bruités), jamais par une moyenne.
Paris est natif en 75056 (code communal officiel) ; Marseille et
Lyon sont déjà au code commune (les arrondissements ARM sont exclus
par le filtre GEO_OBJECT = COM).

Millésime unique 2023 : valeurs identiques aux quatre pivots et dans
les trois partitions de scénario (plateau, aucune projection).

Sorties : data/metrics/scenario={...}/indicator={voiture_menages,
voiture_travail,transports_communs}.parquet et
data/metrics/mobilite_metadata.json. Les statistiques par densité
utilisent le champ DENS7 (grille INSEE) du fichier BPE 2025 déjà
téléchargé pour la Phase E, quand il est présent.

Usage : .venv/bin/python scripts/build_mobilite_partitions.py
"""

import json
import zipfile
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
LOGEMENT_ZIP = ROOT / "data" / "sources" / "rp" / "DS_RP_LOGEMENT_PRINC_2023.csv"
NAVETTES_ZIP = ROOT / "data" / "sources" / "rp" / "DS_RP_NAVETTES_PRINC_2023.csv"
BPE_PATH = ROOT / "data" / "sources" / "bpe" / "BPE25.parquet"
REF_PATH = ROOT / "data" / "geo" / "communes_reference.parquet"
OUT_DIR = ROOT / "data" / "metrics"
MIN_EFFECTIF = 30


def extraire_data(zip_path: Path, dest: Path) -> Path:
    with zipfile.ZipFile(zip_path) as z:
        noms = [n for n in z.namelist() if n.endswith("_data.csv")]
        if not noms:
            raise SystemExit(f"Aucun fichier *_data.csv dans {zip_path.name}.")
        dest.write_bytes(z.read(noms[0]))
    return dest


def main() -> None:
    for zp in (LOGEMENT_ZIP, NAVETTES_ZIP):
        if not zp.exists():
            raise SystemExit(
                f"Archive absente : {zp}. Téléchargez les fichiers Melodi INSEE "
                "DS_RP_LOGEMENT_PRINC_2023 et DS_RP_NAVETTES_PRINC_2023 (voir en-tête)."
            )
    tmp_dir = ROOT / "data" / "sources" / "_rp_tmp"
    tmp_dir.mkdir(exist_ok=True)
    try:
        logement = extraire_data(LOGEMENT_ZIP, tmp_dir / "logement.csv")
        navettes = extraire_data(NAVETTES_ZIP, tmp_dir / "navettes.csv")

        con = duckdb.connect()
        con.execute("SET threads=4")
        con.execute(
            """
            CREATE TEMP TABLE menages AS
            SELECT GEO AS code_insee,
                   100.0 * max(CASE WHEN CARS = 'C_GE1' THEN v END) / max(CASE WHEN CARS = '_T' THEN v END) AS part,
                   max(CASE WHEN CARS = '_T' THEN v END) AS effectif
            FROM (
              SELECT GEO, CARS, try_cast(OBS_VALUE AS DOUBLE) AS v
              FROM read_csv(?, header = true, sep = ';', all_varchar = true, null_padding = true, ignore_errors = true)
              WHERE GEO_OBJECT = 'COM' AND TIME_PERIOD = '2023' AND RP_MEASURE = 'DWELLINGS' AND OCS = 'DW_MAIN'
                AND BUILD_END = '_T' AND CARPARK = '_T' AND L_STAY = '_T' AND NOR = '_T'
                AND NRG_SRC = '_T' AND TDW = '_T' AND TSH = '_T' AND CARS IN ('C_GE1', '_T')
            )
            GROUP BY 1
            """,
            [str(logement)],
        )
        con.execute(
            """
            CREATE TEMP TABLE actifs AS
            SELECT GEO AS code_insee,
                   100.0 * max(CASE WHEN TRANS = '5' THEN v END) / max(CASE WHEN TRANS = '_T' THEN v END) AS part_voiture,
                   100.0 * coalesce(max(CASE WHEN TRANS = '6' THEN v END), 0) / max(CASE WHEN TRANS = '_T' THEN v END) AS part_tc,
                   max(CASE WHEN TRANS = '_T' THEN v END) AS effectif
            FROM (
              SELECT GEO, TRANS, try_cast(OBS_VALUE AS DOUBLE) AS v
              FROM read_csv(?, header = true, sep = ';', all_varchar = true, null_padding = true, ignore_errors = true)
              WHERE GEO_OBJECT = 'COM' AND TIME_PERIOD = '2023' AND RP_MEASURE = 'POP'
                AND AGE = 'Y_GE15' AND EMPSTA_ENQ = '1' AND WORK_AREA = '_T' AND TRANS IN ('5', '6', '_T')
            )
            GROUP BY 1
            """,
            [str(navettes)],
        )

        stats = con.execute(
            """
            SELECT
              (SELECT round(sum(part * effectif) / sum(effectif), 1) FROM menages WHERE effectif > 0) AS menages_pondere,
              (SELECT round(median(part), 1) FROM menages WHERE effectif > 0) AS menages_median_commune,
              (SELECT round(sum(part_voiture * effectif) / sum(effectif), 1) FROM actifs WHERE effectif > 0) AS travail_pondere,
              (SELECT round(median(part_voiture), 1) FROM actifs WHERE effectif > 0) AS travail_median_commune,
              (SELECT round(median(part_tc), 1) FROM actifs WHERE effectif > 0) AS tc_median_commune,
              (SELECT round(100.0 * avg(CASE WHEN part_voiture >= 80 THEN 1 ELSE 0 END), 1) FROM actifs WHERE effectif > 0) AS pct_communes_voit80,
              (SELECT count(*) FROM menages WHERE effectif > 0 AND effectif < ?) AS communes_menages_faible_effectif,
              (SELECT count(*) FROM actifs WHERE effectif > 0 AND effectif < ?) AS communes_actifs_faible_effectif
            """,
            [MIN_EFFECTIF, MIN_EFFECTIF],
        ).fetchone()
        print("Statistiques mobilité :", stats)

        densite = []
        if BPE_PATH.exists():
            con.execute(
                """
                CREATE TEMP TABLE dens AS
                SELECT CASE WHEN substr(DEPCOM, 1, 3) = '751' THEN '75056'
                            WHEN substr(DEPCOM, 1, 3) = '132' THEN '13055'
                            WHEN substr(DEPCOM, 1, 3) = '693' THEN '69123'
                            ELSE DEPCOM END AS code_insee,
                       any_value(DENS7) AS dens7
                FROM read_parquet(?) GROUP BY 1
                """,
                [str(BPE_PATH)],
            )
            densite = con.execute(
                """
                SELECT d.dens7, count(*), round(median(m.part), 0), round(median(a.part_voiture), 0), round(median(a.part_tc), 0)
                FROM dens d
                JOIN menages m USING (code_insee)
                JOIN actifs a USING (code_insee)
                GROUP BY 1 ORDER BY 1
                """
            ).fetchall()
            print("Densité (niveau, communes, médiane %ménages, %travail voiture, %TC) :", densite)

        indicateurs = {
            "voiture_menages": ("menages", "part"),
            "voiture_travail": ("actifs", "part_voiture"),
            "transports_communs": ("actifs", "part_tc"),
        }
        for indicateur, (table, colonne) in indicateurs.items():
            for scenario in ("ssp126", "ssp245", "ssp585"):
                out = OUT_DIR / f"scenario={scenario}" / f"indicator={indicateur}.parquet"
                con.execute(
                    f"""
                    COPY (
                      WITH base AS (
                        SELECT
                          ref.code_insee,
                          CASE WHEN t.effectif >= {MIN_EFFECTIF} THEN t.{colonne} ELSE NULL END AS part,
                          coalesce(t.effectif, 0) AS effectif
                        FROM read_parquet(?) ref
                        LEFT JOIN {table} t USING (code_insee)
                      ),
                      lignes AS (
                        SELECT code_insee, unnest([1990, 2025, 2050, 2100]) AS year FROM base
                      )
                      SELECT
                        b.code_insee,
                        l.year::SMALLINT AS year,
                        coalesce(b.part, 0)::FLOAT AS hazard_raw,
                        coalesce(b.part, 0)::FLOAT AS hazard_local_100m,
                        CASE WHEN b.part IS NULL THEN -1 ELSE (b.part / 100)::FLOAT END AS exposure_score,
                        CASE WHEN b.part IS NULL THEN -1 ELSE (1 - b.part / 100)::FLOAT END AS vulnerability_score,
                        CASE WHEN b.part IS NULL THEN -1 ELSE (b.part / 100)::FLOAT END AS composite_risk_score,
                        ?::VARCHAR AS scenario
                      FROM lignes l JOIN base b USING (code_insee)
                      ORDER BY b.code_insee, l.year
                    ) TO ? (FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL 3)
                    """,
                    [str(REF_PATH), scenario, str(out)],
                )
                n = con.execute("SELECT count(*) FROM read_parquet(?)", [str(out)]).fetchone()[0]
                print(f"{out.relative_to(ROOT)} : {n} lignes")
    finally:
        for f in tmp_dir.iterdir():
            f.unlink()
        tmp_dir.rmdir()

    metadata = {
        "story": "peut-on-vivre-sans-voiture",
        "indicators": ["voiture_menages", "voiture_travail", "transports_communs"],
        "data_nature": "observed",
        "derived": True,
        "sources": [
            {
                "name": "Recensement de la population 2023 — Logements, principaux indicateurs (DS_RP_LOGEMENT_PRINC)",
                "publisher": "INSEE via API Melodi (data.gouv.fr)",
                "license": "Licence Ouverte 2.0 (lov2)",
                "coverage": "Communes de résidence, ménages en résidence principale, millésime 2023",
                "retrieved": "2026-11-04",
            },
            {
                "name": "Recensement de la population 2023 — Déplacements domicile-travail, principaux indicateurs (DS_RP_NAVETTES_PRINC)",
                "publisher": "INSEE via API Melodi (data.gouv.fr)",
                "license": "Licence Ouverte 2.0 (lov2)",
                "coverage": "Actifs occupés de 15 ans ou plus, par commune de résidence, millésime 2023",
                "retrieved": "2026-11-04",
            },
        ],
        "method": {
            "voiture_menages": "100 × ménages disposant d'au moins une voiture (CARS = C_GE1) / ensemble des ménages (résidences principales).",
            "voiture_travail": "100 × actifs occupés allant travailler en voiture (TRANS = 5) / ensemble des actifs occupés de 15 ans ou plus, tous lieux de travail.",
            "transports_communs": "Même dénominateur, TRANS = 6 (transports en commun).",
            "fiabilite": f"Effectif communal inférieur à {MIN_EFFECTIF} (ménages ou actifs) : part remplacée par la sentinelle -1 « non établi », jamais par une moyenne.",
            "horizons": "Millésime 2023 unique affiché aux quatre pivots (plateau, aucune projection), partitions de scénario identiques.",
        },
        "statistics": {
            "menages_avec_voiture_national_pondere_pct": stats[0],
            "menages_avec_voiture_mediane_communale_pct": stats[1],
            "travail_voiture_national_pondere_pct": stats[2],
            "travail_voiture_mediane_communale_pct": stats[3],
            "travail_tc_mediane_communale_pct": stats[4],
            "pct_communes_travail_voiture_au_moins_80": stats[5],
            "communes_faible_effectif_menages": stats[6],
            "communes_faible_effectif_actifs": stats[7],
            "par_densite_insee_7_niveaux": [
                {
                    "niveau": d[0],
                    "communes": d[1],
                    "mediane_menages_voiture_pct": d[2],
                    "mediane_travail_voiture_pct": d[3],
                    "mediane_travail_tc_pct": d[4],
                }
                for d in densite
            ],
        },
        "limitations": [
            "Possession, usage et dépendance sont trois choses différentes : ces parts ne mesurent ni l'absence d'alternative, ni les distances, ni les temps de trajet.",
            "Recensement par collecte tournante : les valeurs communales sont des estimations centrées sur 2023, bruitées dans les petites communes (d'où la sentinelle sous 30 effectifs).",
            "Mode de transport principal déclaré pour le trajet domicile-travail uniquement : les autres motifs de déplacement ne sont pas couverts.",
            "Jointure sur le référentiel communes du projet (35 000 codes) : une partie des communes réelles n'est pas cartographiée.",
        ],
        "pipeline": "scripts/build_mobilite_partitions.py",
    }
    (OUT_DIR / "mobilite_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Métadonnées :", OUT_DIR / "mobilite_metadata.json")


if __name__ == "__main__":
    main()

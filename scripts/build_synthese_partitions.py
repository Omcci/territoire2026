#!/usr/bin/env python3
"""
Pipeline reproductible — synthèse « Les territoires face à leurs
fragilités » (Phase G). Aucun téléchargement : lit les partitions
observées déjà produites (Phases C, D, E, F).

Principe : PAS de score global. Un comptage transparent de dimensions
observées franchissant un seuil défavorable documenté, à poids égaux
par construction (une dimension = un point). Les seuils sont des
conventions de lecture, pas des normes scientifiques :

- Mémoire des catastrophes lourde : au moins 10 arrêtés CatNat
  reconnus depuis 1982 (GASPAR, voir build_catnat_partitions.py) ;
- Services essentiels rares sur place : au plus 2 des 7 familles du
  panier BPE présentes dans la commune (build_bpe_partitions.py) ;
- Dépendance automobile au travail : au moins 80 % des actifs occupés
  allant travailler en voiture (RP 2023, build_mobilite_partitions.py).
Dimension non comptée : le prix immobilier (ni favorable ni
défavorable en soi ; affiché en contexte dans la fiche), les
transports en commun (lecture inverse de la dimension voiture), et
les quatre couches climat du projet, SYNTHÉTIQUES de démonstration
(heatwave, rga, flooding, water_stress) : exclues du comptage pour ne
pas mélanger observé et synthétique.

Donnée manquante : si la part voiture n'est pas établie (sentinelle
-1, moins de 30 actifs), le cumul vaut -1 « non établi » : on ne
compte jamais sur un nombre de dimensions réduit sans le dire.

composite = cumul / 3 ; hazard = cumul (0 à 3). Valeurs de l'état
observé le plus récent (2025/2023) affichées aux quatre pivots et
dans les trois partitions de scénario (plateau, aucune projection).

Sorties : data/metrics/scenario={ssp126,ssp245,ssp585}/indicator=fragilites.parquet
et data/metrics/synthese_metadata.json (avec l'audit des indicateurs).

Usage : .venv/bin/python scripts/build_synthese_partitions.py
"""

import json
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
METRICS = ROOT / "data" / "metrics"
REF_SCENARIO = "ssp245"
SEUIL_CATNAT = 10
SEUIL_SERVICES_MAX = 2
SEUIL_VOITURE = 80.0


def charge(con: duckdb.DuckDBPyConnection, indicateur: str, alias: str) -> None:
    path = METRICS / f"scenario={REF_SCENARIO}" / f"indicator={indicateur}.parquet"
    if not path.exists():
        raise SystemExit(f"Partition source absente : {path}. Lancez les pipelines des phases C à F.")
    con.execute(
        f"CREATE TEMP TABLE {alias} AS "
        f"SELECT code_insee, hazard_raw AS h, composite_risk_score AS c "
        f"FROM read_parquet(?) WHERE year = 2025",
        [str(path)],
    )


def main() -> None:
    con = duckdb.connect()
    charge(con, "catnat", "t_catnat")
    charge(con, "services", "t_services")
    charge(con, "voiture_travail", "t_voiture")
    con.execute(
        f"""
        CREATE TEMP TABLE synthese AS
        SELECT
          c.code_insee,
          CASE WHEN v.c < 0 THEN NULL
               ELSE (CASE WHEN c.h >= {SEUIL_CATNAT} THEN 1 ELSE 0 END)
                  + (CASE WHEN s.c <= {SEUIL_SERVICES_MAX}.0 / 7 + 0.001 THEN 1 ELSE 0 END)
                  + (CASE WHEN v.h >= {SEUIL_VOITURE} THEN 1 ELSE 0 END)
          END AS cumul
        FROM t_catnat c
        JOIN t_services s USING (code_insee)
        JOIN t_voiture v USING (code_insee)
        """
    )
    stats = con.execute(
        """
        SELECT
          (SELECT count(*) FROM synthese WHERE cumul IS NOT NULL) AS evaluees,
          (SELECT count(*) FROM synthese WHERE cumul IS NULL) AS non_evaluees,
          (SELECT count(*) FROM synthese WHERE cumul = 3) AS cumul_3,
          (SELECT count(*) FROM synthese WHERE cumul = 0) AS cumul_0,
          (SELECT round(100.0 * avg(CASE WHEN cumul = 3 THEN 1 ELSE 0 END), 1) FROM synthese WHERE cumul IS NOT NULL) AS pct_3
        """
    ).fetchone()
    print("Statistiques synthèse :", stats)
    combinaisons = con.execute(
        """
        SELECT
          (SELECT count(*) FROM synthese WHERE cumul IS NOT NULL
             AND cumul - (CASE WHEN c.h >= 10 THEN 1 ELSE 0 END) = 2 AND c.h < 10) AS services_voiture_sans_catnat
        FROM t_catnat c LIMIT 1
        """
    ).fetchone()
    print("Combinaison services+voiture sans mémoire lourde :", combinaisons)

    for scenario in ("ssp126", "ssp245", "ssp585"):
        out = METRICS / f"scenario={scenario}" / "indicator=fragilites.parquet"
        con.execute(
            """
            COPY (
              SELECT
                code_insee,
                year::SMALLINT AS year,
                coalesce(cumul, 0)::FLOAT AS hazard_raw,
                coalesce(cumul, 0)::FLOAT AS hazard_local_100m,
                CASE WHEN cumul IS NULL THEN -1 ELSE (cumul::FLOAT / 3) END AS exposure_score,
                CASE WHEN cumul IS NULL THEN -1 ELSE (cumul::FLOAT / 3) END AS vulnerability_score,
                CASE WHEN cumul IS NULL THEN -1 ELSE (cumul::FLOAT / 3) END AS composite_risk_score,
                ?::VARCHAR AS scenario
              FROM (
                SELECT s.code_insee, s.cumul, unnest([1990, 2025, 2050, 2100]) AS year
                FROM synthese s
              )
              ORDER BY code_insee, year
            ) TO ? (FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL 3)
            """,
            [scenario, str(out)],
        )
        n = con.execute("SELECT count(*) FROM read_parquet(?)", [str(out)]).fetchone()[0]
        print(f"{out.relative_to(ROOT)} : {n} lignes")

    metadata = {
        "indicator": "fragilites",
        "label": "Fragilités cumulées (observées)",
        "data_nature": "observed_derived",
        "method": {
            "principe": "Comptage de dimensions observées franchissant un seuil défavorable (poids égaux), pas un score : aucune pondération différentielle, aucune normalisation inter-indicateurs.",
            "seuils": {
                "memoire_catnat": f"au moins {SEUIL_CATNAT} arrêtés CatNat reconnus depuis 1982 (GASPAR)",
                "services_rares": f"au plus {SEUIL_SERVICES_MAX} des 7 familles de services présentes dans la commune (BPE 2025)",
                "dependance_voiture": f"au moins {SEUIL_VOITURE:.0f} % des actifs occupés allant travailler en voiture (RP 2023)",
            },
            "donnees_manquantes": "Part voiture non établie (moins de 30 actifs) : cumul = -1 « non établi », jamais calculé sur un nombre réduit de dimensions.",
            "horizons": "État observé récent affiché aux quatre pivots et trois scénarios (plateau, aucune projection).",
        },
        "audit_indicateurs": [
            {"indicateur": "heatwave / rga / flooding / water_stress", "nature": "synthetic", "source": "Partitions de démonstration du projet (graine fixe)", "usage_synthese": "Exclus du comptage : ne pas mélanger synthétique et observé ; signalés comme démonstration dans la fiche."},
            {"indicateur": "catnat", "nature": "observed", "source": "GASPAR / Géorisques, arrêtés 1982-2025, Licence Ouverte", "usage_synthese": "Dimension mémoire (seuil 10 arrêtés)."},
            {"indicateur": "prix_immo", "nature": "observed", "source": "DGFiP DVF 2023-2025, Licence Ouverte 2.0", "usage_synthese": "Contexte en fiche uniquement : un prix élevé ou bas n'est pas en soi une fragilité."},
            {"indicateur": "services", "nature": "observed", "source": "INSEE BPE au 1er janvier 2025, Licence Ouverte", "usage_synthese": "Dimension services (seuil 2 familles)."},
            {"indicateur": "voiture_travail", "nature": "observed", "source": "INSEE RP 2023 via Melodi, Licence Ouverte 2.0", "usage_synthese": "Dimension dépendance voiture (seuil 80 %)."},
            {"indicateur": "transports_communs", "nature": "observed", "source": "INSEE RP 2023 via Melodi, Licence Ouverte 2.0", "usage_synthese": "Non compté : lecture largement inverse de la dimension voiture ; affiché en fiche."},
            {"indicateur": "voiture_menages", "nature": "observed", "source": "INSEE RP 2023 via Melodi, Licence Ouverte 2.0", "usage_synthese": "Non compté : possession distincte de l'usage ; affiché en récit mobilité."},
        ],
        "statistics": {
            "communes_evaluees": stats[0],
            "communes_non_evaluees": stats[1],
            "cumul_3_dimensions": stats[2],
            "cumul_0_dimension": stats[3],
            "pct_cumul_3": stats[4],
        },
        "limitations": [
            "Les seuils sont des conventions de lecture documentées, pas des normes : déplacer un seuil déplace les effectifs, sans changer les données sources.",
            "La dimension voiture est quasi saturée hors des villes (médiane communale 87 %) : beaucoup de cumuls à 2 dimensions signifient « voiture + une autre dimension ».",
            "Millésimes proches mais distincts (2023, 2025, 1982-2025) : la synthèse juxtapose des états observés récents, elle ne prétend pas à une photographie à date unique.",
            "Présence de services et parts modales sont communales : aucun trajet, aucune distance, aucun temps d'accès n'entre dans le comptage.",
            "Jointure sur le référentiel communes du projet (35 000 codes), limites déjà documentées.",
        ],
        "pipeline": "scripts/build_synthese_partitions.py",
    }
    (METRICS / "synthese_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Métadonnées :", METRICS / "synthese_metadata.json")


if __name__ == "__main__":
    main()

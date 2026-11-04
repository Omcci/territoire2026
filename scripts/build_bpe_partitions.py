#!/usr/bin/env python3
"""
Pipeline reproductible — indicateur « Services essentiels » (Phase E).

Source OBSERVÉE : Base permanente des équipements (BPE) 2025 de l'INSEE,
fichier détail au 1er janvier 2025, téléchargé depuis la page INSEE
« Équipements géolocalisés (commerce, services, sport, santé...) en
2025 » (https://www.insee.fr/fr/statistiques/8217525, fichier
BPE25.parquet, 164 Mo, 2 921 770 équipements). Données INSEE sous
Licence Ouverte. Fichier attendu : data/sources/bpe/BPE25.parquet
(téléchargement manuel, aucun identifiant requis).

Ce que la source mesure — et ne mesure pas :
- La BPE recense les équipements PRÉSENTS dans chaque commune
  (code DEPCOM). Elle ne donne ni distance parcourue, ni temps de
  trajet, ni accessibilité effective pour un habitant : l'indicateur
  est une présence locale, jamais une distance. Le récit le dit.
- Aucun centroïde du référentiel projet (synthétique) n'est utilisé
  pour calculer une distance : seuls les comptages par code INSEE
  réel alimentent l'analyse, comme pour DVF et GASPAR.

Panier « services essentiels du quotidien » (7 familles, codes TYPEQU
de la nomenclature BPE 2025, fichier TYPEQU_2025.csv de l'INSEE) :
- Médecin généraliste : D265
- Pharmacie : D307
- École (maternelle, primaire, élémentaire) : C107, C108, C109
- Alimentation (hypermarché, supermarché, épicerie,
  boulangerie-pâtisserie) : B104, B105, B202, B207
- Bureau de poste : A206
- Banque, caisse d'épargne : A203
- Petite enfance (accueil du jeune enfant, micro-crèche) : D502, D509

Indicateur par commune :
- composite = familles présentes / 7 (diversité locale, 0 à 1) ;
- hazard = nombre total d'équipements du panier dans la commune ;
- exposure = composite ; vulnerability = (7 - familles) / 7
  (part manquante du panier, dérivée).
Paris, Marseille, Lyon : la BPE ventile par arrondissement (751xx,
132xx, 6938x), regroupés sur le code métrique projet de la
commune-centre (75056, 13055, 69123), codes communaux officiels.
Une commune absente de la BPE n'y a aucun équipement recensé : son
zéro est un zéro observé dans la source, pas une donnée manquante —
aucune sentinelle, aucune moyenne de substitution dans ce pipeline.

Horizons et scénarios : millésime unique au 1er janvier 2025, valeurs
identiques aux quatre pivots et dans les trois partitions (plateau,
aucune projection).

Sorties : data/metrics/scenario={ssp126,ssp245,ssp585}/indicator=services.parquet
et data/metrics/services_metadata.json.

Usage : .venv/bin/python scripts/build_bpe_partitions.py
"""

import json
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
BPE_PATH = ROOT / "data" / "sources" / "bpe" / "BPE25.parquet"
REF_PATH = ROOT / "data" / "geo" / "communes_reference.parquet"
OUT_DIR = ROOT / "data" / "metrics"

FAMILLES = {
    "medecin_generaliste": ["D265"],
    "pharmacie": ["D307"],
    "ecole": ["C107", "C108", "C109"],
    "alimentation": ["B104", "B105", "B202", "B207"],
    "bureau_de_poste": ["A206"],
    "banque": ["A203"],
    "petite_enfance": ["D502", "D509"],
}
NB_FAMILLES = len(FAMILLES)


def main() -> None:
    if not BPE_PATH.exists():
        raise SystemExit(
            f"Fichier absent : {BPE_PATH}. Téléchargez BPE25.parquet (164 Mo) "
            "depuis https://www.insee.fr/fr/statistiques/8217525 (INSEE, Licence Ouverte)."
        )
    codes_tous = [c for codes in FAMILLES.values() for c in codes]
    cases = ",\n              ".join(
        f"max(CASE WHEN TYPEQU IN ({', '.join(repr(c) for c in codes)}) THEN 1 ELSE 0 END) AS f_{nom}"
        for nom, codes in FAMILLES.items()
    )
    somme_familles = " + ".join(f"f_{nom}" for nom in FAMILLES)

    con = duckdb.connect()
    con.execute("SET threads=4")
    con.execute(
        f"""
        CREATE TEMP TABLE communes AS
        SELECT
          CASE
            WHEN substr(DEPCOM, 1, 3) = '751' THEN '75056'
            WHEN substr(DEPCOM, 1, 3) = '132' THEN '13055'
            WHEN substr(DEPCOM, 1, 3) = '693' THEN '69123'
            ELSE DEPCOM
          END AS code_insee,
          any_value(DENS7) AS dens7,
          {cases},
          count(*) FILTER (WHERE TYPEQU IN ({', '.join(repr(c) for c in codes_tous)})) AS n_essentiels
        FROM read_parquet(?)
        GROUP BY 1
        """,
        [str(BPE_PATH)],
    )
    con.execute(
        f"CREATE TEMP TABLE services AS SELECT *, ({somme_familles}) AS familles FROM communes"
    )

    stats = con.execute(
        """
        SELECT
          (SELECT count(*) FROM read_parquet(?)) AS equipements_bpe,
          (SELECT count(*) FROM services) AS communes_bpe,
          (SELECT count(*) FROM services WHERE familles = 0) AS communes_zero_famille,
          (SELECT round(100.0 * avg(CASE WHEN familles = 0 THEN 1 ELSE 0 END), 1) FROM services) AS pct_zero_famille,
          (SELECT round(100.0 * avg(CASE WHEN f_medecin_generaliste = 0 AND f_pharmacie = 0 THEN 1 ELSE 0 END), 1) FROM services) AS pct_sans_medecin_ni_pharmacie,
          (SELECT round(100.0 * avg(f_ecole::FLOAT), 1) FROM services) AS pct_avec_ecole,
          (SELECT round(100.0 * avg(f_banque::FLOAT), 1) FROM services) AS pct_avec_banque,
          (SELECT count(*) FROM services WHERE code_insee IN (SELECT code_insee FROM read_parquet(?))) AS communes_cartographiees
        """,
        [str(BPE_PATH), str(REF_PATH)],
    ).fetchone()
    print("Statistiques BPE services :", stats)
    densite = con.execute(
        """
        SELECT dens7, count(*),
               round(100.0 * avg(CASE WHEN familles <= 1 THEN 1 ELSE 0 END), 1),
               round(100.0 * avg(CASE WHEN familles >= 5 THEN 1 ELSE 0 END), 1),
               median(familles)
        FROM services GROUP BY 1 ORDER BY 1
        """
    ).fetchall()
    print("Densité (niveau, communes, % 0-1 famille, % >=5, médiane) :", densite)

    for scenario in ("ssp126", "ssp245", "ssp585"):
        out = OUT_DIR / f"scenario={scenario}" / "indicator=services.parquet"
        con.execute(
            f"""
            COPY (
              WITH base AS (
                SELECT
                  ref.code_insee,
                  coalesce(s.familles, 0) AS familles,
                  coalesce(s.n_essentiels, 0) AS n_essentiels
                FROM read_parquet(?) ref
                LEFT JOIN services s USING (code_insee)
              ),
              lignes AS (
                SELECT code_insee, unnest([1990, 2025, 2050, 2100]) AS year FROM base
              )
              SELECT
                b.code_insee,
                l.year::SMALLINT AS year,
                b.n_essentiels::FLOAT AS hazard_raw,
                b.n_essentiels::FLOAT AS hazard_local_100m,
                (b.familles::FLOAT / {NB_FAMILLES}) AS exposure_score,
                (({NB_FAMILLES} - b.familles)::FLOAT / {NB_FAMILLES}) AS vulnerability_score,
                (b.familles::FLOAT / {NB_FAMILLES}) AS composite_risk_score,
                ?::VARCHAR AS scenario
              FROM lignes l JOIN base b USING (code_insee)
              ORDER BY b.code_insee, l.year
            ) TO ? (FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL 3)
            """,
            [str(REF_PATH), scenario, str(out)],
        )
        n = con.execute("SELECT count(*) FROM read_parquet(?)", [str(out)]).fetchone()[0]
        print(f"{out.relative_to(ROOT)} : {n} lignes")

    metadata = {
        "indicator": "services",
        "label": "Services essentiels",
        "data_nature": "observed",
        "derived": True,
        "source": {
            "name": "Base permanente des équipements (BPE) 2025",
            "publisher": "INSEE",
            "page": "https://www.insee.fr/fr/statistiques/8217525",
            "file": "BPE25.parquet (au 1er janvier 2025, 164 Mo)",
            "license": "Licence Ouverte",
            "retrieved": "2026-11-04",
        },
        "basket": {nom: codes for nom, codes in FAMILLES.items()},
        "method": {
            "composite": "Familles du panier présentes dans la commune / 7 (présence locale recensée par la BPE).",
            "hazard": "Nombre total d'équipements du panier présents dans la commune.",
            "arrondissements": "Paris, Marseille, Lyon regroupés sur la commune officielle (751xx vers 75056, 132xx vers 13055, 6938x vers 69123).",
            "horizons": "Millésime unique au 1er janvier 2025 affiché aux quatre pivots (plateau, aucune projection), partitions de scénario identiques.",
        },
        "statistics": {
            "equipements_bpe_total": stats[0],
            "communes_recensees_bpe": stats[1],
            "communes_sans_aucune_famille": stats[2],
            "pct_sans_aucune_famille": stats[3],
            "pct_sans_medecin_ni_pharmacie": stats[4],
            "pct_avec_ecole": stats[5],
            "pct_avec_banque": stats[6],
            "communes_cartographiees_ref_projet": stats[7],
            "par_densite_insee_7_niveaux": [
                {
                    "niveau": d[0],
                    "communes": d[1],
                    "pct_0_ou_1_famille": d[2],
                    "pct_5_familles_ou_plus": d[3],
                    "familles_medianes": d[4],
                }
                for d in densite
            ],
        },
        "limitations": [
            "Présence dans la commune, pas distance : la BPE ne donne ni trajet, ni temps d'accès, ni service effectivement utilisé ; un service absent sur place peut être proche dans la commune voisine (bassin de vie).",
            "Aucune pondération par la population : une famille présente compte de la même façon dans un village et dans une métropole ; le volume d'équipements (hazard) n'est pas une offre par habitant.",
            "Le panier de 7 familles est un choix documenté (nomenclature TYPEQU BPE 2025), pas une définition officielle des « services essentiels ».",
            "Une commune absente de la BPE n'y a aucun équipement recensé : zéro observé dans la source, à l'échelle de son exhaustivité.",
            "Jointure sur le référentiel communes du projet (35 000 codes) : une partie des communes réelles n'est pas cartographiée (voir statistiques).",
        ],
        "pipeline": "scripts/build_bpe_partitions.py",
    }
    (OUT_DIR / "services_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Métadonnées :", OUT_DIR / "services_metadata.json")


if __name__ == "__main__":
    main()

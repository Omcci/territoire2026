#!/usr/bin/env python3
"""
Pipeline reproductible — récit « Habiter cher et exposé » (Phase D).

Croisement de deux sources OBSERVÉES officielles, par code INSEE commune :

1. Prix immobiliers — Demandes de valeurs foncières (DVF), DGFiP via
   data.gouv.fr, dataset « Demandes de valeurs foncières » (Licence
   Ouverte 2.0 / lov2), fichiers annuels officiels :
     valeursfoncieres-2023.txt.zip (71 698 391 o. annoncés),
     valeursfoncieres-2024.txt.zip (65 417 590 o.),
     valeursfoncieres-2025.txt.zip (71 037 343 o.),
   téléchargés le 2026-11-04 dans data/sources/dvf/ depuis
   https://static.data.gouv.fr/resources/demandes-de-valeurs-foncieres/
   DVF couvre la métropole et les DOM, hors Alsace, Moselle et Mayotte.

2. Mémoire des catastrophes — base GASPAR (voir
   scripts/build_catnat_partitions.py), cumul d'arrêtés CatNat par
   commune, événements 1982-2025.

Méthode prix (documentée, aucune valeur inventée) :
- Lignes DVF « Vente » de type local Maison ou Appartement, valeur
  foncière > 0, surface réelle bâtie entre 10 et 500 m², prix au m²
  entre 150 et 40 000 € (filtre des valeurs aberrantes ; la médiane est
  de toute façon robuste). Déduplication sur l'identité du local vendu
  (commune, date, type, valeur, surface) : deux ventes distinctes au
  même prix au m² restent deux ventes (audit D.1 — l'ancienne clé
  (commune, prix) en effondrait 22 % à tort).
- Paris, Marseille et Lyon : DVF ventile les ventes par arrondissement
  (751xx, 132xx, 6938x). Elles sont regroupées sur le code métrique
  officielle (75056, 13055, 69123) ; côté GASPAR, Paris est
  natif en 75056.
- Les fichiers DVF bruts ne portent pas d'identifiant de mutation
  exploitable (colonne « Identifiant de document » vide, « No
  disposition » recyclé par document) : le prix au m² est donc calculé
  par local d'habitation vendu, pas par mutation regroupée. Les ventes
  multi-locaux restent une source de bruit, limitée par la médiane.
- Prix communal = médiane des prix au m² 2023-2025. Une commune n'est
  dite « fiable » qu'avec au moins 30 ventes retenues sur la période :
  en dessous, prix et conjonction sont laissés à 0 (non établis), jamais
  remplacés par une moyenne départementale ou nationale dans ce pipeline.
- Paris, Marseille, Lyon : ventes par arrondissement regroupées sur
  le code métrique projet de la commune-centre (voir Méthode prix).

Valeurs manquantes (audit D.1) : une commune sans prix fiable reçoit
composite = -1 (sentinelle « non établi »), jamais 0 — 0 reste réservé
aux valeurs réelles les plus basses. Le rendu cartographique affiche
-1 en gris « données insuffisantes », la légende le distingue des
paliers de prix, et aucun remplissage par moyenne n'est appliqué à ces
indicateurs (voir completeMetrics, mode preserveMissing).

Indicateurs produits :
- prix_immo : hazard = prix médian €/m² (0 si non fiable),
  composite = percentile national du prix médian parmi les communes
  fiables, ou -1 si non fiable.
- cher_expose : conjonction dérivée, uniquement si prix fiable :
  composite = percentile_prix × min(cumul CatNat, 25) / 25, ou -1 si
  prix non fiable ; hazard = cumul CatNat RÉEL de la commune (toutes
  communes, fiable ou non). Ce produit met en évidence la
  cooccurrence, pas une exposition physique des logements.

Horizons : prix 2023-2025 et mémoire 1982-2025 sont des stocks observés.
Les quatre années pivots (1990, 2025, 2050, 2100) portent la même
valeur — plateau volontaire, aucune série temporelle ni projection.
Les trois partitions de scénario sont identiques : une trajectoire
d'émissions ne s'applique pas à des transactions et arrêtés observés.

Sorties :
  data/metrics/scenario={ssp126,ssp245,ssp585}/indicator=prix_immo.parquet
  data/metrics/scenario={ssp126,ssp245,ssp585}/indicator=cher_expose.parquet
  data/metrics/dvf_catnat_metadata.json

Usage : .venv/bin/python scripts/build_dvf_catnat_partitions.py
"""

import json
import zipfile
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DVF_DIR = ROOT / "data" / "sources" / "dvf"
DVF_YEARS = (2023, 2024, 2025)
GASPAR_ZIP = ROOT / "data" / "sources" / "gaspar.zip"
REF_PATH = ROOT / "data" / "geo" / "communes_reference.parquet"
OUT_DIR = ROOT / "data" / "metrics"
MIN_VENTES = 30  # seuil de fiabilité du prix médian communal
CAP_CATNAT = 25  # plafond mémoire, aligné sur l'indicateur catnat


def extraire_csv(zip_path: Path, prefixe: str, dest: Path) -> Path:
    with zipfile.ZipFile(zip_path) as z:
        noms = [n for n in z.namelist() if n.startswith(prefixe)]
        if not noms:
            raise SystemExit(f"Aucun fichier {prefixe}* dans {zip_path.name}.")
        dest.write_bytes(z.read(noms[0]))
    return dest


def main() -> None:
    fichiers_dvf = []
    for annee in DVF_YEARS:
        zp = DVF_DIR / f"valeursfoncieres-{annee}.txt.zip"
        if not zp.exists():
            raise SystemExit(
                f"Archive DVF absente : {zp}. Téléchargez les fichiers annuels "
                "officiels depuis data.gouv.fr « Demandes de valeurs foncières » "
                "(voir en-tête du script)."
            )
        fichiers_dvf.append(zp)
    if not GASPAR_ZIP.exists():
        raise SystemExit(f"Archive absente : {GASPAR_ZIP} (voir build_catnat_partitions.py).")

    tmp_dir = ROOT / "data" / "sources" / "_dvf_tmp"
    tmp_dir.mkdir(exist_ok=True)
    txts = []
    try:
        for zp in fichiers_dvf:
            dest = tmp_dir / (zp.stem + ".txt")
            with zipfile.ZipFile(zp) as z:
                dest.write_bytes(z.read(z.namelist()[0]))
            txts.append(str(dest))
        catnat_csv = extraire_csv(GASPAR_ZIP, "catnat_gaspar_", tmp_dir / "_catnat.csv")

        con = duckdb.connect()
        con.execute("SET threads=4")
        con.execute(
            """
            CREATE TEMP TABLE ventes AS
            SELECT code_insee, prix_m2
            FROM (
              SELECT DISTINCT
                CASE
                  WHEN substr(code_brut, 1, 3) = '751' THEN '75056'
                  WHEN substr(code_brut, 1, 3) = '132' THEN '13055'
                  WHEN substr(code_brut, 1, 3) = '693' THEN '69123'
                  ELSE code_brut
                END AS code_insee,
                datemut, tpl, val, surf,
                val / surf AS prix_m2
              FROM (
                SELECT
                  CASE
                    WHEN "Code departement" IN ('971','972','973','974','976')
                      THEN "Code departement" || substr(lpad("Code commune", 3, '0'), 2, 2)
                    ELSE "Code departement" || lpad("Code commune", 3, '0')
                  END AS code_brut,
                  "Date mutation" AS datemut,
                  "Type local" AS tpl,
                  try_cast(replace("Valeur fonciere", ',', '.') AS DOUBLE) AS val,
                  try_cast(replace("Surface reelle bati", ',', '.') AS DOUBLE) AS surf
                FROM read_csv(?, header = true, sep = '|', all_varchar = true,
                              null_padding = true, ignore_errors = true)
                WHERE "Nature mutation" = 'Vente'
                  AND "Type local" IN ('Maison', 'Appartement')
              )
              WHERE val > 0 AND surf BETWEEN 10 AND 500 AND val / surf BETWEEN 150 AND 40000
            )
            """,
            [txts],
        )
        con.execute(
            """
            CREATE TEMP TABLE prix AS
            SELECT code_insee, count(*) AS n_ventes, median(prix_m2) AS prix_median
            FROM ventes GROUP BY 1
            """
        )
        con.execute(
            """
            CREATE TEMP TABLE catnat AS
            SELECT code_commune AS code_insee,
                   count(*) AS cumul
            FROM read_csv(?, header = true, sep = ';', columns = {
              'id_gaspar': 'VARCHAR', 'code_commune': 'VARCHAR',
              'libelle_commune': 'VARCHAR', 'num_risque_jo': 'VARCHAR',
              'lib_risque_jo': 'VARCHAR', 'date_debut': 'VARCHAR',
              'date_fin': 'VARCHAR', 'date_signature_arrete': 'VARCHAR',
              'date_publication_jo': 'VARCHAR', 'date_modification': 'VARCHAR'
            })
            WHERE code_commune IS NOT NULL
            GROUP BY 1
            """,
            [str(catnat_csv)],
        )
        con.execute(
            f"""
            CREATE TEMP TABLE croise AS
            SELECT
              p.code_insee,
              p.n_ventes,
              p.prix_median,
              coalesce(c.cumul, 0) AS cumul_catnat,
              percent_rank() OVER (ORDER BY p.prix_median) AS prix_percentile
            FROM prix p LEFT JOIN catnat c USING (code_insee)
            WHERE p.n_ventes >= {MIN_VENTES}
            """
        )

        stats = con.execute(
            """
            SELECT
              (SELECT count(*) FROM ventes) AS ventes_retenues,
              (SELECT count(*) FROM croise) AS communes_fiables,
              (SELECT round(median(prix_median)) FROM croise) AS prix_median_communes,
              (SELECT round(median(prix_m2)) FROM ventes) AS prix_median_transactions,
              (SELECT count(*) FROM croise
                 WHERE code_insee IN (SELECT code_insee FROM read_parquet(?) )) AS communes_fiables_cartographiees,
              (SELECT round(corr(rp, rc), 3) FROM (
                 SELECT rank() OVER (ORDER BY prix_median) AS rp,
                        rank() OVER (ORDER BY cumul_catnat) AS rc FROM croise)) AS spearman,
              (SELECT count(*) FROM croise
                 WHERE prix_percentile >= 0.75 AND cumul_catnat >= 10) AS cher_et_memoir,
              (SELECT count(*) FROM croise WHERE prix_percentile >= 0.75) AS cher_total,
              (SELECT count(*) FROM croise
                 WHERE prix_percentile < 0.25 AND cumul_catnat >= 10) AS abordable_et_memoir
            """
        ,
            [str(REF_PATH)],
        ).fetchone()
        print("Statistiques DVF × CatNat :", stats)
        quartiles = con.execute(
            """
            SELECT quartile, count(*), round(median(prix_median)),
                   round(median(cumul_catnat), 1),
                   round(100.0 * avg(CASE WHEN cumul_catnat >= 10 THEN 1 ELSE 0 END), 1)
            FROM (SELECT *, ntile(4) OVER (ORDER BY prix_median) AS quartile FROM croise)
            GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        print("Quartiles de prix (quartile, communes, prix médian, CatNat médian, % >=10 arrêtés) :", quartiles)
        exemples = con.execute(
            """
            SELECT c.code_insee, round(c.prix_median), c.n_ventes, c.cumul_catnat
            FROM croise c
            WHERE c.prix_percentile >= 0.9 AND c.cumul_catnat >= 15
            ORDER BY c.cumul_catnat DESC LIMIT 10
            """
        ).fetchall()
        print("Exemples prix top décile et mémoire >= 15 arrêtés (code, prix, ventes, arrêtés) :", exemples)

        annees = (1990, 2025, 2050, 2100)
        for indicateur in ("prix_immo", "cher_expose"):
            if indicateur == "prix_immo":
                hazard = "prix_median"
                composite = "CASE WHEN n_ventes >= " + str(MIN_VENTES) + " AND prix_median > 0 THEN prix_percentile ELSE -1 END"
                exposure = composite
                vulnerability = composite
            else:
                hazard = "cumul_catnat::FLOAT"
                composite = (
                    "CASE WHEN n_ventes >= " + str(MIN_VENTES) + " AND prix_median > 0 "
                    f"THEN prix_percentile * least(cumul_catnat, {CAP_CATNAT})::FLOAT / {CAP_CATNAT} ELSE -1 END"
                )
                exposure = "CASE WHEN n_ventes >= " + str(MIN_VENTES) + " AND prix_median > 0 THEN prix_percentile ELSE -1 END"
                vulnerability = f"least(cumul_catnat, {CAP_CATNAT})::FLOAT / {CAP_CATNAT}"
            for scenario in ("ssp126", "ssp245", "ssp585"):
                out = OUT_DIR / f"scenario={scenario}" / f"indicator={indicateur}.parquet"
                con.execute(
                    f"""
                    COPY (
                      WITH base AS (
                        SELECT
                          ref.code_insee,
                          coalesce(x.n_ventes, 0) AS n_ventes,
                          CASE WHEN x.code_insee IS NOT NULL THEN x.prix_median ELSE 0 END AS prix_median,
                          coalesce(c.cumul, 0) AS cumul_catnat,
                          CASE WHEN x.code_insee IS NOT NULL THEN x.prix_percentile ELSE 0 END AS prix_percentile
                        FROM read_parquet(?) ref
                        LEFT JOIN croise x USING (code_insee)
                        LEFT JOIN catnat c USING (code_insee)
                      ),
                      lignes AS (
                        SELECT code_insee, unnest(?) AS year FROM base
                      )
                      SELECT
                        b.code_insee,
                        l.year::SMALLINT AS year,
                        ({hazard})::FLOAT AS hazard_raw,
                        ({hazard})::FLOAT AS hazard_local_100m,
                        ({exposure})::FLOAT AS exposure_score,
                        ({vulnerability})::FLOAT AS vulnerability_score,
                        ({composite})::FLOAT AS composite_risk_score,
                        ?::VARCHAR AS scenario
                      FROM lignes l JOIN base b USING (code_insee)
                      ORDER BY b.code_insee, l.year
                    ) TO ? (FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL 3)
                    """,
                    [str(REF_PATH), list(annees), scenario, str(out)],
                )
                n = con.execute("SELECT count(*) FROM read_parquet(?)", [str(out)]).fetchone()[0]
                print(f"{out.relative_to(ROOT)} : {n} lignes")
    finally:
        for f in tmp_dir.iterdir():
            f.unlink()
        tmp_dir.rmdir()

    metadata = {
        "story": "habiter-cher-expose",
        "indicators": ["prix_immo", "cher_expose"],
        "data_nature": "observed",
        "derived": True,
        "sources": [
            {
                "name": "Demandes de valeurs foncières (DVF)",
                "publisher": "Direction générale des finances publiques (DGFiP), via data.gouv.fr",
                "files": [f"valeursfoncieres-{a}.txt.zip" for a in DVF_YEARS],
                "license": "Licence Ouverte 2.0 (lov2)",
                "coverage": "Métropole et DOM, hors Alsace, Moselle et Mayotte ; ventes 2023-2025",
                "retrieved": "2026-11-04",
            },
            {
                "name": "Base nationale GASPAR — arrêtés de catastrophe naturelle",
                "publisher": "Ministère de la Transition écologique (Géorisques)",
                "license": "Licence Ouverte (fr-lo)",
                "coverage": "Arrêtés par commune, événements 1982-2025",
                "retrieved": "2026-11-04",
            },
        ],
        "method": {
            "prix": "Médiane communale des prix au m² des ventes de maisons et appartements 2023-2025 (DVF), par local vendu, déduplication sur (commune, date, type, valeur, surface), prix bornés 150-40 000 €/m², surface 10-500 m². Le chiffre vedette est la médiane DES COMMUNES fiables (chaque commune compte une fois) ; la médiane des transactions poolées est publiée séparément dans les statistiques.",
            "arrondissements": "Ventes DVF par arrondissement regroupées sur la commune officielle (Paris 751xx vers 75056, Marseille 132xx vers 13055, Lyon 6938x vers 69123) ; arrêtés GASPAR de Paris natifs en 75056.",
            "valeurs_manquantes": "Composite -1 = prix non établi (moins de 30 ventes ou hors DVF) : rendu gris distinct du zéro réel, exclu des moyennes de complétion, jamais remplacé par une moyenne dans ces indicateurs.",
            "fiabilite": f"Prix dit fiable si au moins {MIN_VENTES} ventes retenues sur 2023-2025 ; en dessous, prix et conjonction = 0 (non établis), sans remplacement par une moyenne.",
            "conjonction_cher_expose": f"percentile national du prix médian × min(cumul CatNat, {CAP_CATNAT}) / {CAP_CATNAT}, uniquement si prix fiable.",
            "horizons": "Valeurs observées affichées aux quatre pivots (plateau) : ni série de prix passée, ni projection.",
            "scenarios": "Partitions de scénario identiques : trajectoire d'émissions sans objet sur des observations.",
        },
        "statistics": {
            "ventes_retenues_2023_2025": stats[0],
            "communes_prix_fiable": stats[1],
            "prix_median_des_communes_fiables_eur_m2": stats[2],
            "prix_median_des_transactions_eur_m2": stats[3],
            "communes_fiables_cartographiees_ref_projet": stats[4],
            "spearman_prix_vs_cumul_catnat": stats[5],
            "communes_cheres_et_memoir_lourde": stats[6],
            "communes_cheres_quartile_superieur": stats[7],
            "communes_abordables_et_memoir_lourde": stats[8],
            "quartiles_prix": [
                {
                    "quartile": q[0],
                    "communes": q[1],
                    "prix_median_eur_m2": q[2],
                    "catnat_median": q[3],
                    "pct_au_moins_10_arretes": q[4],
                }
                for q in quartiles
            ],
        },
        "limitations": [
            "Le prix communal DVF décrit les biens vendus, pas le parc de logements ni sa valeur d'assurance ; il ignore Alsace, Moselle et Mayotte (absence DVF).",
            "Un arrêté CatNat est une reconnaissance administrative passée, pas une probabilité d'événement futur ni une mesure d'exposition des logements de la commune.",
            "Le croisement est communal : il ne dit pas que les logements chers d'une commune sont ceux qui ont été sinistrés.",
            f"Seules {stats[1]} communes ont un prix fiable (>= {MIN_VENTES} ventes) : les autres s'affichent en gris « données insuffisantes » (composite -1), non interprétées individuellement.",
            "La corrélation prix-mémoire est faible ; la conjonction cartographiée montre des cooccurrences locales, pas une causalité.",
            "Jointure sur le référentiel communes du projet (35 000 codes) : les transactions dont le code est absent du référentiel ne sont pas cartographiées.",
        ],
        "pipeline": "scripts/build_dvf_catnat_partitions.py",
    }
    (OUT_DIR / "dvf_catnat_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Métadonnées :", OUT_DIR / "dvf_catnat_metadata.json")


if __name__ == "__main__":
    main()

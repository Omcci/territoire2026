#!/usr/bin/env python3.11
"""
Territoires 2100 — Phase 1 : génération des données "gold" (démonstration).

Script autonome. Il génère, sans aucune source externe :

1. ``data/geo/communes.geojson``
   GeoJSON simplifié des ~35 000 communes de France métropolitaine + Corse,
   prêt pour Tippecanoe (voir ``pipeline/build_pmtiles.sh``). Contrat PMTiles :
   chaque feature ne porte QUE ``code_insee`` et ``nom``.

2. ``data/geo/communes_reference.parquet``
   Table de référence communale (centroïde, département, covariables IGN-like)
   servant de dimension de jointure et d'entrée au modèle de downscaling.

3. ``data/metrics/scenario={ssp126|ssp245|ssp585}/indicator={rga|heatwave|flooding|water_stress}.parquet``
   GeoParquet partitionné (partitionnement Hive sur ``scenario``) au schéma
   contractuel strict :

       code_insee          VARCHAR (dictionnaire)  clé de jointure
       year                INT16                   1950..2100 (ici pivots)
       hazard_raw          FLOAT32                 valeur brute type DRIAS
       hazard_local_100m   FLOAT32                 aléa micro-affiné (100 m)
       exposure_score      FLOAT32                 0..1
       vulnerability_score FLOAT32                 0..1
       composite_risk_score FLOAT32                0..1

   Formule du score composite (Aléa préalablement normalisé 0..1 par
   indicateur, percentiles 1/99) :

       Composite = (Aléa^1.2 * 0.45) + (Exposition * 0.30) + (Vulnérabilité * 0.25)

Données 100 % synthétiques mais géographiquement cohérentes : les gradients
sont construits à partir d'un modèle physique simplifié de la France
(hexagone + Corse, littoral, Seine/Loire/Rhône/Garonne/Rhin, Alpes/Pyrénées/
Massif central/Vosges/Jura, bassins argileux, îlots de chaleur urbains).
En production, ce générateur est remplacé par l'ingestion COG DRIAS /
Euro-CORDEX + référentiel Admin Express IGN, sans changer le schéma de sortie.

Unités de ``hazard_raw`` par indicateur :
    heatwave    : nombre de jours/an avec Tmax > 35 °C
    rga         : indice retrait-gonflement des argiles (0..10)
    flooding    : indice d'exposition inondation (jours-équivalents/an, 0..30)
    water_stress: nombre de jours/an de stress hydrique (SPI < -1)

Usage :
    python -m pipeline.generate_gold_data [--n-communes 35000] [--seed 42]
                                          [--out-dir data] [--no-geojson]

Dépendances : numpy, polars (Python >= 3.11).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import polars as pl

# --------------------------------------------------------------------------- #
# Constantes contractuelles
# --------------------------------------------------------------------------- #

SCENARIOS: tuple[str, ...] = ("ssp126", "ssp245", "ssp585")
INDICATORS: tuple[str, ...] = ("rga", "heatwave", "flooding", "water_stress")
PIVOT_YEARS: tuple[int, ...] = (1990, 2025, 2050, 2100)

W_HAZARD, W_EXPOSURE, W_VULNERABILITY = 0.45, 0.30, 0.25

# --------------------------------------------------------------------------- #
# Géographie de référence (simplifiée, suffisante pour des gradients réalistes)
# Coordonnées (lon, lat) WGS84.
# --------------------------------------------------------------------------- #

# Contour terrestre (masque d'acceptation des centroïdes). Sens horaire.
MAINLAND_POLYGON: np.ndarray = np.array(
    [
        (-4.78, 48.38), (-3.40, 48.82), (-1.95, 49.68), (-1.15, 49.35),
        (0.25, 49.38), (1.60, 50.13), (2.45, 51.05), (3.45, 50.78),
        (4.25, 49.95), (5.05, 49.55), (6.10, 49.45), (8.23, 48.97),
        (7.85, 48.55), (7.59, 47.62), (6.85, 47.45), (6.05, 46.45),
        (6.75, 45.85), (6.95, 44.95), (7.30, 44.15), (7.53, 43.55),
        (6.10, 43.10), (5.30, 43.28), (4.15, 43.52), (3.15, 42.43),
        (1.80, 42.43), (0.65, 42.68), (-0.85, 42.92), (-1.78, 43.37),
        (-1.25, 44.45), (-1.18, 45.65), (-1.55, 46.35), (-2.20, 46.95),
        (-2.15, 47.28), (-1.95, 47.60), (-3.05, 47.55), (-4.35, 47.82),
        (-4.72, 48.35),
    ],
    dtype=np.float64,
)

CORSICA_POLYGON: np.ndarray = np.array(
    [
        (8.55, 43.02), (9.35, 43.03), (9.55, 42.70), (9.55, 42.15),
        (9.25, 41.40), (8.80, 41.35), (8.60, 41.92), (8.55, 42.45),
    ],
    dtype=np.float64,
)

# Littoral métropolitain (pour distance à la côte), d'Hendaye à Menton.
COAST_MAINLAND: np.ndarray = np.array(
    [
        (-1.78, 43.37), (-1.25, 44.45), (-1.18, 45.65), (-1.55, 46.35),
        (-2.20, 46.95), (-2.15, 47.28), (-1.95, 47.60), (-3.05, 47.55),
        (-4.35, 47.82), (-4.72, 48.35), (-4.78, 48.38), (-3.40, 48.82),
        (-1.95, 49.68), (-1.15, 49.35), (0.25, 49.38), (1.60, 50.13),
        (2.45, 51.05), (3.10, 50.90), (2.20, 50.75), (1.60, 50.13),
        (0.25, 49.38), (-0.60, 49.38), (-1.15, 49.35), (-1.95, 49.68),
    ],
    dtype=np.float64,
)
# Littoral corse (boucle simplifiée).
COAST_CORSICA: np.ndarray = np.array(
    [
        (8.55, 43.02), (9.35, 43.03), (9.55, 42.70), (9.55, 42.15),
        (9.25, 41.40), (8.80, 41.35), (8.60, 41.92), (8.55, 42.45),
        (8.55, 43.02),
    ],
    dtype=np.float64,
)

# Axes fluviaux majeurs (polylignes) pour distance aux cours d'eau.
RIVERS: dict[str, np.ndarray] = {
    "seine": np.array([(0.25, 49.38), (1.10, 49.45), (2.35, 48.86), (3.05, 48.40), (3.90, 48.95)], dtype=np.float64),
    "loire": np.array([(-2.15, 47.28), (-1.55, 47.22), (-0.55, 47.47), (0.69, 47.39), (1.91, 47.90), (2.75, 47.60), (3.55, 47.05)], dtype=np.float64),
    "rhone": np.array([(6.10, 46.20), (5.75, 45.76), (5.10, 45.55), (4.85, 44.80), (4.65, 43.95), (4.60, 43.55)], dtype=np.float64),
    "garonne": np.array([(-0.58, 44.84), (0.20, 44.50), (0.95, 44.10), (1.44, 43.60)], dtype=np.float64),
    "rhin": np.array([(7.59, 47.62), (7.75, 48.57), (8.23, 48.97), (7.90, 49.30)], dtype=np.float64),
    "dordogne": np.array([(-0.58, 44.95), (0.25, 44.85), (1.10, 44.85), (1.90, 44.90)], dtype=np.float64),
}

# Massifs : (lon0, lat0, hauteur_m, sigma_deg)
MOUNTAINS: tuple[tuple[float, float, float, float], ...] = (
    (6.60, 45.90, 3000.0, 0.85),   # Alpes du Nord
    (6.40, 44.45, 2400.0, 0.80),   # Alpes du Sud
    (-0.50, 42.90, 2000.0, 0.55),  # Pyrénées occidentales
    (2.00, 42.60, 2200.0, 0.55),   # Pyrénées orientales
    (3.60, 45.05, 1400.0, 0.90),   # Massif central
    (6.90, 48.00, 1100.0, 0.42),   # Vosges
    (6.30, 46.70, 1300.0, 0.48),   # Jura
    (4.00, 47.20, 700.0, 0.38),    # Morvan
    (-3.50, 48.30, 320.0, 0.60),   # Monts d'Arrée
    (5.00, 49.90, 480.0, 0.45),    # Ardennes
    (9.00, 42.20, 1900.0, 0.48),   # Corse
)

# Bassins sédimentaires argileux (RGA) : (lon0, lat0, intensité, sigma_deg)
CLAY_BASINS: tuple[tuple[float, float, float, float], ...] = (
    (2.50, 48.60, 1.00, 1.45),   # Bassin parisien
    (-0.40, 44.40, 0.90, 1.15),  # Bassin aquitain
    (4.80, 44.60, 0.80, 0.70),   # Couloir rhodanien
    (7.55, 48.30, 0.70, 0.55),   # Plaine d'Alsace
    (3.10, 50.50, 0.75, 0.75),   # Plaine du Nord
    (1.60, 43.70, 0.65, 0.70),   # Piémont toulousain
)
# Massifs cristallins (faible argile) : réutilise MOUNTAINS en négatif.
FOREST_AREAS: tuple[tuple[float, float, float, float], ...] = (
    (-1.00, 44.20, 0.85, 0.85),  # Landes de Gascogne
    (5.20, 49.85, 0.75, 0.60),   # Ardennes
    (6.80, 48.05, 0.80, 0.50),   # Vosges
    (3.60, 45.10, 0.65, 0.90),   # Massif central
    (5.90, 47.00, 0.60, 0.70),   # Jura / Doubs
    (-3.60, 48.35, 0.55, 0.65),  # Bretagne intérieure
    (2.60, 48.45, 0.55, 0.80),   # Île-de-France forestière
)

# Agglomérations : (lon, lat, poids, sigma_deg) — indice d'urbanisation.
CITIES: tuple[tuple[float, float, float, float], ...] = (
    (2.35, 48.86, 100.0, 0.55), (4.83, 45.76, 28.0, 0.35), (5.37, 43.30, 26.0, 0.30),
    (1.44, 43.60, 20.0, 0.32), (-0.58, 44.84, 19.0, 0.32), (-1.55, 47.22, 16.0, 0.30),
    (3.06, 50.63, 22.0, 0.35), (7.75, 48.57, 13.0, 0.28), (7.27, 43.70, 14.0, 0.25),
    (3.88, 43.61, 11.0, 0.25), (-1.68, 48.11, 11.0, 0.27), (5.72, 45.19, 10.0, 0.22),
    (1.10, 49.44, 9.0, 0.25), (5.93, 43.12, 9.0, 0.20), (5.04, 47.32, 7.0, 0.22),
    (-0.55, 47.47, 7.0, 0.22), (3.08, 45.78, 7.0, 0.22), (-4.49, 48.39, 6.0, 0.20),
    (0.10, 49.49, 6.0, 0.20), (4.03, 49.26, 6.0, 0.22), (2.30, 49.89, 5.0, 0.20),
    (1.26, 45.83, 5.0, 0.20), (2.89, 42.70, 5.0, 0.18), (6.02, 47.24, 4.0, 0.18),
    (1.91, 47.90, 5.0, 0.20), (6.18, 49.12, 5.0, 0.20), (-0.37, 49.18, 5.0, 0.20),
    (6.18, 48.69, 5.0, 0.20),
)

# Départements : (code, lon_préfecture, lat_préfecture, nb_communes_approx, sigma_deg)
DEPARTMENTS: tuple[tuple[str, float, float, int, float], ...] = (
    ("01", 5.35, 46.20, 393, 0.30), ("02", 3.62, 49.56, 800, 0.34), ("03", 3.33, 46.34, 317, 0.32),
    ("04", 6.23, 44.09, 198, 0.36), ("05", 6.08, 44.56, 162, 0.34), ("06", 7.27, 43.70, 163, 0.30),
    ("07", 4.60, 44.73, 335, 0.32), ("08", 4.72, 49.77, 449, 0.30), ("09", 1.60, 42.96, 327, 0.30),
    ("10", 4.07, 48.30, 431, 0.32), ("11", 2.35, 43.21, 433, 0.32), ("12", 2.57, 44.35, 285, 0.34),
    ("13", 5.37, 43.30, 119, 0.30), ("14", -0.37, 49.18, 527, 0.32), ("15", 2.44, 45.05, 246, 0.30),
    ("16", 0.16, 45.65, 364, 0.32), ("17", -0.97, 45.75, 463, 0.34), ("18", 2.40, 47.08, 287, 0.32),
    ("19", 1.77, 45.27, 279, 0.30), ("2A", 8.74, 41.92, 124, 0.26), ("2B", 9.45, 42.70, 236, 0.28),
    ("21", 5.04, 47.32, 698, 0.36), ("22", -2.77, 48.51, 348, 0.34), ("23", 1.87, 46.17, 256, 0.32),
    ("24", 0.72, 45.18, 505, 0.36), ("25", 6.02, 47.24, 563, 0.32), ("26", 4.89, 44.93, 363, 0.32),
    ("27", 1.15, 49.02, 585, 0.32), ("28", 1.49, 48.44, 365, 0.32), ("29", -4.10, 48.40, 277, 0.36),
    ("30", 4.36, 43.84, 351, 0.32), ("31", 1.44, 43.60, 586, 0.34), ("32", 0.59, 43.65, 461, 0.34),
    ("33", -0.58, 44.84, 535, 0.38), ("34", 3.88, 43.61, 342, 0.32), ("35", -1.68, 48.11, 333, 0.32),
    ("36", 1.65, 46.80, 241, 0.32), ("37", 0.69, 47.39, 272, 0.30), ("38", 5.72, 45.19, 512, 0.34),
    ("39", 5.55, 46.67, 494, 0.30), ("40", -0.85, 43.90, 327, 0.38), ("41", 1.33, 47.59, 276, 0.30),
    ("42", 4.39, 45.44, 323, 0.30), ("43", 3.88, 45.04, 257, 0.30), ("44", -1.55, 47.22, 207, 0.32),
    ("45", 1.91, 47.90, 325, 0.32), ("46", 1.68, 44.65, 313, 0.32), ("47", 0.62, 44.40, 319, 0.32),
    ("48", 3.50, 44.52, 152, 0.30), ("49", -0.55, 47.47, 177, 0.32), ("50", -1.09, 49.11, 446, 0.32),
    ("51", 4.03, 49.26, 613, 0.36), ("52", 5.14, 48.11, 426, 0.32), ("53", -0.77, 48.07, 240, 0.30),
    ("54", 6.18, 48.69, 591, 0.30), ("55", 5.17, 49.16, 486, 0.32), ("56", -2.75, 47.66, 249, 0.34),
    ("57", 6.18, 49.12, 725, 0.34), ("58", 3.16, 46.99, 309, 0.32), ("59", 3.06, 50.63, 648, 0.34),
    ("60", 2.08, 49.43, 679, 0.32), ("61", 0.09, 48.43, 385, 0.32), ("62", 2.78, 50.29, 890, 0.36),
    ("63", 3.08, 45.78, 464, 0.32), ("64", -0.37, 43.30, 546, 0.38), ("65", 0.08, 43.23, 469, 0.30),
    ("66", 2.89, 42.70, 226, 0.30), ("67", 7.75, 48.57, 514, 0.30), ("68", 7.34, 47.81, 366, 0.28),
    ("69", 4.83, 45.76, 267, 0.26), ("70", 6.15, 47.62, 539, 0.30), ("71", 4.83, 46.31, 565, 0.34),
    ("72", 0.20, 48.00, 354, 0.32), ("73", 5.92, 45.57, 273, 0.32), ("74", 6.12, 46.20, 279, 0.30),
    ("75", 2.35, 48.86, 1, 0.06), ("76", 1.10, 49.44, 708, 0.34), ("77", 2.66, 48.54, 507, 0.38),
    ("78", 2.13, 48.80, 259, 0.26), ("79", -0.46, 46.32, 256, 0.32), ("80", 2.30, 49.89, 772, 0.34),
    ("81", 2.15, 43.93, 314, 0.32), ("82", 1.35, 44.02, 195, 0.28), ("83", 6.12, 43.12, 153, 0.34),
    ("84", 4.81, 43.95, 151, 0.26), ("85", -1.43, 46.67, 258, 0.34), ("86", 0.34, 46.58, 266, 0.32),
    ("87", 1.26, 45.83, 195, 0.30), ("88", 6.45, 48.17, 507, 0.32), ("89", 3.57, 47.80, 423, 0.34),
    ("90", 6.86, 47.64, 101, 0.16), ("91", 2.43, 48.62, 194, 0.22), ("92", 2.22, 48.85, 36, 0.14),
    ("93", 2.42, 48.91, 40, 0.14), ("94", 2.46, 48.79, 47, 0.14), ("95", 2.10, 49.05, 184, 0.24),
)

SAINTS: tuple[str, ...] = (
    "Pierre", "Martin", "Jean", "Paul", "Laurent", "Michel", "Étienne", "André",
    "Julien", "Germain", "Rémy", "Denis", "Cloud", "Léger", "Médard", "Aubin",
    "Hilaire", "Maurice", "Victor", "Georges", "Christophe", "Nicolas", "Antoine",
    "François", "Louis", "Marcel", "Quentin", "Valentin", "Félix", "Côme",
)
ROOTS: tuple[str, ...] = (
    "Aubigny", "Beaumont", "Belleville", "Bonneval", "Champagnole", "Clairac",
    "Fontaine", "Grandvilliers", "Longueville", "Montreuil", "Neuville", "Rochefort",
    "Valbonne", "Villeneuve", "Villefranche", "Aumont", "Beauregard", "Castelnau",
    "Dampierre", "Épernon", "Fère", "Gourdon", "Honfleur", "Issoire", "Jarnac",
    "Laval", "Mirande", "Nogent", "Orbec", "Pontivy", "Questembert", "Riez",
    "Sancerre", "Tournon", "Uzès", "Vernon", "Wassy", "Yssingeaux", "Zudausques",
    "Argenton", "Boussac", "Châtillon", "Domfront", "Eu", "Falaise", "Gaillac",
    "Lectoure", "Mirepoix", "Nontron", "Pamiers", "Riom", "Salers", "Thouars",
)
SUFFIXES: tuple[str, ...] = (
    "", "", "", "", "-sur-Loire", "-sur-Seine", "-sur-Mer", "-en-Bresse",
    "-en-Provence", "-les-Bains", "-le-Château", "-la-Ville", "-sur-Rhône",
    "-en-Puisaye", "-aux-Bois", "-le-Roi", "-sur-Garonne", "-en-Gâtinais",
    "-les-Mines", "-du-Jardin", "-en-Champagne", "-sur-Saône",
)

# --------------------------------------------------------------------------- #
# Fonctions géographiques vectorisées (numpy)
# --------------------------------------------------------------------------- #

KM_PER_DEG_LAT = 110.54
KM_PER_DEG_LON = 85.0  # approximation à 47°N, suffisante pour des distances indicatives


def _points_in_polygon(lon: np.ndarray, lat: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    """Test d'inclusion vectorisé (ray casting) pour N points x M arêtes."""
    inside = np.zeros(lon.shape, dtype=bool)
    x, y = lon, lat
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        cond_y = (y1 > y) != (y2 > y)
        x_intersect = np.where(cond_y, (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1, np.inf)
        inside ^= cond_y & (x < x_intersect)
    return inside


def _dist_to_polyline_km(lon: np.ndarray, lat: np.ndarray, polyline: np.ndarray) -> np.ndarray:
    """Distance minimale (km, approx. équirectangulaire) de N points à une polyligne."""
    px = lon * KM_PER_DEG_LON
    py = lat * KM_PER_DEG_LAT
    best = np.full(lon.shape, np.inf, dtype=np.float64)
    pts = polyline * np.array([KM_PER_DEG_LON, KM_PER_DEG_LAT])
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        vx, vy = bx - ax, by - ay
        denom = vx * vx + vy * vy + 1e-12
        t = np.clip(((px - ax) * vx + (py - ay) * vy) / denom, 0.0, 1.0)
        dx = px - (ax + t * vx)
        dy = py - (ay + t * vy)
        best = np.minimum(best, np.hypot(dx, dy))
    return best


def altitude_field(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Champ d'altitude synthétique (m) : massifs gaussiens + collines douces."""
    alt = np.full(lon.shape, 85.0, dtype=np.float64)
    for lon0, lat0, height, sigma in MOUNTAINS:
        d2 = (lon - lon0) ** 2 + (lat - lat0) ** 2
        alt += height * np.exp(-d2 / (2.0 * sigma**2))
    alt += 55.0 * np.sin(lon * 2.9 + 1.3) * np.cos(lat * 2.4)
    alt += 35.0 * np.sin(lon * 6.1) * np.sin(lat * 5.3 + 0.7)
    return np.clip(alt, 0.0, 4200.0)


def compute_covariates(lon: np.ndarray, lat: np.ndarray, rng: np.random.Generator) -> dict[str, np.ndarray]:
    """Covariables géographiques IGN-like pour chaque centroïde communal."""
    altitude = altitude_field(lon, lat)

    # Pente et rugosité par différences finies sur le champ d'altitude (±0,04°).
    eps = 0.04
    alt_e, alt_w = altitude_field(lon + eps, lat), altitude_field(lon - eps, lat)
    alt_n, alt_s = altitude_field(lon, lat + eps), altitude_field(lon, lat - eps)
    dx_m = 2 * eps * 111_320.0 * np.cos(np.radians(lat))
    dy_m = 2 * eps * 110_540.0
    grad = np.hypot((alt_e - alt_w) / np.maximum(dx_m, 1.0), (alt_n - alt_s) / dy_m)
    slope_deg = np.degrees(np.arctan(grad))
    roughness = (np.maximum.reduce([alt_e, alt_w, alt_n, alt_s]) - np.minimum.reduce([alt_e, alt_w, alt_n, alt_s]))

    dist_coast = np.minimum(
        _dist_to_polyline_km(lon, lat, COAST_MAINLAND),
        _dist_to_polyline_km(lon, lat, COAST_CORSICA),
    )
    # Plaine littorale : on écrête l'altitude au bord de mer.
    altitude = np.where(dist_coast < 2.0, np.minimum(altitude, 30.0), altitude)

    dist_river = np.full(lon.shape, np.inf)
    for polyline in RIVERS.values():
        dist_river = np.minimum(dist_river, _dist_to_polyline_km(lon, lat, polyline))

    # Indice d'argile : bassins sédimentaires moins socle cristallin des massifs.
    clay = np.zeros(lon.shape, dtype=np.float64)
    for lon0, lat0, intensity, sigma in CLAY_BASINS:
        clay += intensity * np.exp(-((lon - lon0) ** 2 + (lat - lat0) ** 2) / (2.0 * sigma**2))
    for lon0, lat0, _h, sigma in MOUNTAINS:
        clay -= 0.55 * np.exp(-((lon - lon0) ** 2 + (lat - lat0) ** 2) / (2.0 * (sigma * 1.15) ** 2))
    clay_index = np.clip(clay, 0.0, 1.0)

    # Urbanisation : somme des gaussiennes des agglomérations + bruit log-normal.
    urban_raw = np.full(lon.shape, 0.12, dtype=np.float64)
    for lon0, lat0, weight, sigma in CITIES:
        urban_raw += weight * np.exp(-((lon - lon0) ** 2 + (lat - lat0) ** 2) / (2.0 * sigma**2))
    urban_raw *= np.exp(rng.normal(0.0, 0.45, size=lon.shape))
    lo, hi = np.percentile(urban_raw, [2, 98])
    urban_index = np.clip((urban_raw - lo) / max(hi - lo, 1e-9), 0.0, 1.0)

    forest_raw = np.zeros(lon.shape, dtype=np.float64)
    for lon0, lat0, intensity, sigma in FOREST_AREAS:
        forest_raw += intensity * np.exp(-((lon - lon0) ** 2 + (lat - lat0) ** 2) / (2.0 * sigma**2))
    canopy_pct = np.clip((8.0 + 55.0 * forest_raw + 22.0 * (altitude / 1500.0)) * (1.0 - 0.75 * urban_index)
                          + rng.normal(0.0, 4.0, size=lon.shape), 1.0, 92.0)
    impervious_pct = np.clip(2.0 + 68.0 * urban_index**1.6 + rng.normal(0.0, 3.0, size=lon.shape), 0.5, 95.0)

    return {
        "altitude_m": altitude.astype(np.float64),
        "slope_deg": slope_deg,
        "roughness_m": roughness,
        "dist_coast_km": dist_coast,
        "dist_river_km": dist_river,
        "clay_index": clay_index,
        "urban_index": urban_index,
        "canopy_pct": canopy_pct,
        "impervious_pct": impervious_pct,
    }


# --------------------------------------------------------------------------- #
# Génération des communes
# --------------------------------------------------------------------------- #

def _dept_counts(n_target: int) -> dict[str, int]:
    """Répartit exactement ``n_target`` communes entre départements (plus fort reste)."""
    codes = [d[0] for d in DEPARTMENTS]
    weights = np.array([d[3] for d in DEPARTMENTS], dtype=np.float64)
    raw = weights / weights.sum() * n_target
    counts = np.floor(raw).astype(int)
    remainder = n_target - int(counts.sum())
    order = np.argsort(-(raw - counts))
    for idx in order[:remainder]:
        counts[idx] += 1
    counts = np.maximum(counts, 1)  # Paris garde sa commune unique
    # Réajustement exact si le max() a créé un écart.
    while int(counts.sum()) > n_target:
        j = int(np.argmax(counts))
        counts[j] -= 1
    while int(counts.sum()) < n_target:
        j = int(np.argmax(weights))
        counts[j] += 1
    return {code: int(counts[i]) for i, code in enumerate(codes)}


def _commune_name(rng: np.random.Generator) -> str:
    r = rng.random()
    if r < 0.34:
        prefix = "Saint" if rng.random() < 0.72 else "Sainte"
        return f"{prefix}-{SAINTS[int(rng.integers(0, len(SAINTS)))]}"
    name = ROOTS[int(rng.integers(0, len(ROOTS)))]
    suffix = SUFFIXES[int(rng.integers(0, len(SUFFIXES)))]
    return f"{name}{suffix}"


def generate_communes(n_target: int, rng: np.random.Generator) -> dict[str, np.ndarray | list[str]]:
    """Centroïdes communaux : tirage gaussien autour des préfectures, rejet hors terre."""
    counts = _dept_counts(n_target)
    dept_meta = {d[0]: d for d in DEPARTMENTS}

    all_lon: list[np.ndarray] = []
    all_lat: list[np.ndarray] = []
    all_dept: list[str] = []
    all_code: list[str] = []
    all_name: list[str] = []

    for code, n in counts.items():
        _, plon, plat, _, sigma = dept_meta[code]
        polygon = CORSICA_POLYGON if code in ("2A", "2B") else MAINLAND_POLYGON
        accepted_lon: list[float] = []
        accepted_lat: list[float] = []
        tries = 0
        while len(accepted_lon) < n and tries < 60:
            tries += 1
            m = max(n * 2, 32)
            cand_lon = plon + rng.normal(0.0, sigma, size=m)
            cand_lat = plat + rng.normal(0.0, sigma * 0.82, size=m)
            ok = _points_in_polygon(cand_lon, cand_lat, polygon)
            for lo_, la_ in zip(cand_lon[ok], cand_lat[ok]):
                if len(accepted_lon) >= n:
                    break
                accepted_lon.append(float(lo_))
                accepted_lat.append(float(la_))
        # Filet de sécurité (jamais attendu) : jitter serré autour de la préfecture.
        while len(accepted_lon) < n:
            accepted_lon.append(plon + float(rng.normal(0.0, 0.03)))
            accepted_lat.append(plat + float(rng.normal(0.0, 0.03)))

        all_lon.append(np.array(accepted_lon[:n]))
        all_lat.append(np.array(accepted_lat[:n]))
        all_dept.extend([code] * n)
        all_code.extend(f"{code}{i + 1:03d}" for i in range(n))
        all_name.extend(_commune_name(rng) for _ in range(n))

    return {
        "code_insee": all_code,
        "nom": all_name,
        "dept": all_dept,
        "lon": np.concatenate(all_lon),
        "lat": np.concatenate(all_lat),
    }


def _octagon(lon: float, lat: float, radius_km: float, rng: np.random.Generator) -> list[list[float]]:
    """Polygone communal synthétique (octogone jitteré) autour du centroïde."""
    r_lat = radius_km / 111.32
    r_lon = radius_km / (111.32 * max(math.cos(math.radians(lat)), 0.2))
    coords: list[list[float]] = []
    offset = rng.random() * math.pi / 4.0
    for k in range(8):
        ang = offset + k * math.pi / 4.0
        jr = radius_km * float(rng.uniform(0.72, 1.28))
        jr_lat = jr / 111.32
        jr_lon = jr / (111.32 * max(math.cos(math.radians(lat)), 0.2))
        coords.append([round(lon + jr_lon * math.cos(ang), 5), round(lat + jr_lat * math.sin(ang), 5)])
    coords.append(coords[0])
    return coords


# --------------------------------------------------------------------------- #
# Modèles d'aléa (hazard_raw / hazard_local_100m) — gradients cohérents
# --------------------------------------------------------------------------- #

def delta_t(year: int, scenario: str) -> float:
    """Réchauffement synthétique (°C vs 1990) par scénario SSP."""
    t = max(year - 1990, 0)
    if scenario == "ssp126":
        return float(1.45 * (1.0 - math.exp(-t / 30.0)))       # pic puis stabilisation
    if scenario == "ssp245":
        return float(0.021 * t)                                 # ~ +2,3 °C en 2100
    if scenario == "ssp585":
        return float(0.034 * t + 0.000045 * t * t)              # ~ +4,3 °C en 2100
    raise ValueError(f"Scénario inconnu : {scenario}")


def hazard_series(
    indicator: str,
    cov: dict[str, np.ndarray],
    lat: np.ndarray,
    year: int,
    scenario: str,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray]:
    """Retourne (hazard_raw, hazard_local_100m) vectorisés pour un horizon donné."""
    n = len(lat)
    dt = delta_t(year, scenario)
    alt = cov["altitude_m"]
    slope = cov["slope_deg"]
    coast = cov["dist_coast_km"]
    river = cov["dist_river_km"]
    clay = cov["clay_index"]
    urban = cov["urban_index"]
    canopy = cov["canopy_pct"] / 100.0
    imperv = cov["impervious_pct"] / 100.0
    noise = rng.normal(0.0, 1.0, size=n)

    if indicator == "heatwave":
        raw = (9.0 + (44.8 - lat) * 2.4 - 0.011 * alt - 5.5 * np.exp(-coast / 25.0)
               + 7.0 * urban + 1.6 * noise)
        # Hausse amortie par l'altitude : pas de jours > 35 °C à 2 000 m, même en 2100.
        raw = np.clip(raw, 0.0, 45.0) * (1.0 + 0.16 * dt) + 2.9 * dt * np.exp(-alt / 1500.0)
        local = raw * (1.0 + 0.14 * imperv - 0.10 * canopy) - 0.004 * np.maximum(alt - 150.0, 0.0) + 0.5 * noise
        return np.clip(raw, 0.0, 95.0), np.clip(local, 0.0, 98.0)

    if indicator == "rga":
        dry_south = np.clip((45.6 - lat) / 6.0, -0.6, 1.0)
        raw = clay * (5.2 + 1.3 * dry_south + 0.85 * dt) + 0.35 * noise
        local = np.clip(raw, 0.0, 10.0) * (0.88 + 0.24 * clay) * (1.0 + 0.06 * imperv) + 0.15 * noise
        return np.clip(raw, 0.0, 10.0), np.clip(local, 0.0, 10.0)

    if indicator == "flooding":
        lowland = np.exp(-np.maximum(alt - 40.0, 0.0) / 260.0)
        raw = (13.0 * np.exp(-river / 6.0) + 8.0 * np.exp(-coast / 4.5) * lowland
               + 5.5 * imperv + 2.0 * np.exp(-river / 45.0) + 0.8 * noise)
        raw = np.clip(raw, 0.0, 30.0) * (1.0 + 0.09 * dt)
        local = raw * (1.0 + 0.22 * imperv) * np.clip(1.0 - slope / 55.0, 0.35, 1.0) + 0.4 * noise
        return np.clip(raw, 0.0, 32.0), np.clip(local, 0.0, 34.0)

    if indicator == "water_stress":
        south = np.clip((45.9 - lat) / 5.0, -1.0, 1.0)
        raw = (17.0 + 10.0 * south + 6.0 * (1.0 - np.exp(-river / 16.0))
               - 7.0 * canopy + 3.0 * np.exp(-coast / 60.0) + 1.8 * noise)
        raw = np.clip(raw, 0.0, 110.0) * (1.0 + 0.10 * dt) + 4.2 * dt
        local = raw * (1.0 - 0.10 * canopy + 0.05 * np.clip(slope / 20.0, 0.0, 1.0)) + 1.2 * noise
        return np.clip(raw, 0.0, 140.0), np.clip(local, 0.0, 145.0)

    raise ValueError(f"Indicateur inconnu : {indicator}")


def exposure_vulnerability(
    cov: dict[str, np.ndarray], lat: np.ndarray, lon: np.ndarray, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray]:
    """Scores d'exposition et de vulnérabilité (0..1), indépendants du scénario."""
    n = len(lat)
    urban = cov["urban_index"]
    houses_share = np.clip(0.88 - 0.55 * urban + rng.normal(0.0, 0.07, size=n), 0.05, 0.98)
    exposure = np.clip(0.55 * urban + 0.45 * houses_share * (0.35 + 0.65 * np.sqrt(urban)), 0.0, 1.0)

    rural = 1.0 - urban
    retiree_coast = np.exp(-cov["dist_coast_km"] / 18.0) * np.clip((46.5 - lat) / 4.0, 0.0, 1.0)
    share_65 = np.clip(0.19 + 0.10 * rural + 0.07 * retiree_coast - 0.05 * urban
                       + rng.normal(0.0, 0.025, size=n), 0.05, 0.45)
    cold_north_east = np.clip((lat - 47.6) / 3.2, 0.0, 1.0) * 0.6 + np.clip((lon - 4.6) / 3.4, 0.0, 1.0) * 0.4
    precarity = np.clip(0.34 + 0.22 * cold_north_east + 0.16 * rural - 0.14 * np.exp(
        -((lon - 2.35) ** 2 + (lat - 48.86) ** 2) / (2 * 0.7**2)) + rng.normal(0.0, 0.06, size=n), 0.02, 0.95)
    vulnerability = np.clip(0.5 * (share_65 / 0.45) + 0.5 * precarity, 0.0, 1.0)
    return exposure.astype(np.float64), vulnerability.astype(np.float64)


def composite_score(hazard_local: np.ndarray, exposure: np.ndarray, vulnerability: np.ndarray) -> np.ndarray:
    """Composite = (Aléa_norm^1.2 * 0.45) + (Exposition * 0.30) + (Vulnérabilité * 0.25)."""
    lo, hi = np.percentile(hazard_local, [1, 99])
    hazard_norm = np.clip((hazard_local - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
    return np.clip(hazard_norm**1.2 * W_HAZARD + exposure * W_EXPOSURE + vulnerability * W_VULNERABILITY, 0.0, 1.0)


# --------------------------------------------------------------------------- #
# Écritures
# --------------------------------------------------------------------------- #

def write_geojson(communes: dict, cov: dict[str, np.ndarray], out_path: Path, rng: np.random.Generator) -> None:
    """GeoJSON Tippecanoe-ready : propriétés strictement limitées à code_insee + nom."""
    urban = cov["urban_index"]
    # Aire communale synthétique : dense en ville (petite), étendue en rural/montagne.
    area_km2 = np.clip(4.0 + 26.0 * (1.0 - urban) + 0.012 * cov["altitude_m"], 1.2, 85.0)
    radius_km = np.sqrt(area_km2 / math.pi)

    features: list[dict] = []
    lon, lat = communes["lon"], communes["lat"]
    for i in range(len(lon)):
        features.append(
            {
                "type": "Feature",
                "properties": {"code_insee": communes["code_insee"][i], "nom": communes["nom"][i]},
                "geometry": {"type": "Polygon", "coordinates": [_octagon(float(lon[i]), float(lat[i]), float(radius_km[i]), rng)]},
            }
        )
    payload = {"type": "FeatureCollection", "name": "france_communes", "features": features}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_metrics(
    communes: dict,
    cov: dict[str, np.ndarray],
    exposure: np.ndarray,
    vulnerability: np.ndarray,
    years: tuple[int, ...],
    out_dir: Path,
    rng: np.random.Generator,
) -> list[Path]:
    """Écrit les 12 partitions GeoParquet (3 scénarios x 4 indicateurs)."""
    lat = communes["lat"]
    code = pl.Series("code_insee", communes["code_insee"]).cast(pl.Categorical)
    written: list[Path] = []

    for scenario in SCENARIOS:
        scen_dir = out_dir / f"scenario={scenario}"
        scen_dir.mkdir(parents=True, exist_ok=True)
        for indicator in INDICATORS:
            frames: list[pl.DataFrame] = []
            for year in years:
                raw, local = hazard_series(indicator, cov, lat, year, scenario, rng)
                composite = composite_score(local, exposure, vulnerability)
                frames.append(
                    pl.DataFrame(
                        {
                            "code_insee": code,
                            "year": pl.Series("year", np.full(len(lat), year, dtype=np.int16)),
                            "hazard_raw": raw.astype(np.float32),
                            "hazard_local_100m": local.astype(np.float32),
                            "exposure_score": exposure.astype(np.float32),
                            "vulnerability_score": vulnerability.astype(np.float32),
                            "composite_risk_score": composite.astype(np.float32),
                        }
                    )
                )
            df = pl.concat(frames).sort(["code_insee", "year"])
            # Schéma contractuel strict + types imposés.
            df = df.select(
                pl.col("code_insee").cast(pl.Categorical),
                pl.col("year").cast(pl.Int16),
                pl.col("hazard_raw").cast(pl.Float32),
                pl.col("hazard_local_100m").cast(pl.Float32),
                pl.col("exposure_score").cast(pl.Float32),
                pl.col("vulnerability_score").cast(pl.Float32),
                pl.col("composite_risk_score").cast(pl.Float32),
            )
            target = scen_dir / f"indicator={indicator}.parquet"
            # ZSTD + statistiques : indispensables aux HTTP range requests DuckDB
            # (predicate pushdown sur code_insee / year sans télécharger le fichier).
            df.write_parquet(
                target,
                compression="zstd",
                compression_level=3,
                statistics=True,
                row_group_size=50_000,
                data_page_size=1_048_576,
            )
            written.append(target)
            print(f"  [parquet] {target.relative_to(out_dir.parent)}  rows={df.height:,}")
    return written


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Territoires 2100 — génération des données gold (démonstration).")
    parser.add_argument("--n-communes", type=int, default=35_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out-dir", type=Path, default=Path("data"))
    parser.add_argument("--years", type=str, default=",".join(str(y) for y in PIVOT_YEARS))
    parser.add_argument("--no-geojson", action="store_true", help="Ne pas écrire communes.geojson")
    args = parser.parse_args(argv)

    years = tuple(int(y) for y in args.years.split(",") if y.strip())
    rng = np.random.default_rng(args.seed)
    t0 = time.time()

    print(f"[1/5] Génération de {args.n_communes:,} communes (seed={args.seed}) …")
    communes = generate_communes(args.n_communes, rng)
    print(f"      -> {len(communes['code_insee']):,} centroïdes acceptés dans le masque terrestre")

    print("[2/5] Covariables géographiques (altitude, pente, distances, argile, canopée) …")
    cov = compute_covariates(communes["lon"], communes["lat"], rng)

    print("[3/5] Scores d'exposition / vulnérabilité …")
    exposure, vulnerability = exposure_vulnerability(cov, communes["lat"], communes["lon"], rng)

    geo_dir = args.out_dir / "geo"
    geo_dir.mkdir(parents=True, exist_ok=True)
    ref_path = geo_dir / "communes_reference.parquet"
    ref = pl.DataFrame(
        {
            "code_insee": pl.Series("code_insee", communes["code_insee"]).cast(pl.Categorical),
            "nom": communes["nom"],
            "dept": communes["dept"],
            "lon": communes["lon"].astype(np.float32),
            "lat": communes["lat"].astype(np.float32),
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
        }
    ).sort("code_insee")
    ref.write_parquet(ref_path, compression="zstd", compression_level=3, statistics=True)
    print(f"[4/5] Référence communale -> {ref_path} ({ref_path.stat().st_size / 1e6:.1f} Mo)")

    if not args.no_geojson:
        geojson_path = geo_dir / "communes.geojson"
        write_geojson(communes, cov, geojson_path, rng)
        print(f"      GeoJSON Tippecanoe  -> {geojson_path} ({geojson_path.stat().st_size / 1e6:.1f} Mo)")

    print("[5/5] Écriture du GeoParquet partitionné (scenario x indicator) …")
    metrics_dir = args.out_dir / "metrics"
    written = write_metrics(communes, cov, exposure, vulnerability, years, metrics_dir, rng)

    metadata = {
        "dataset": "territoires-2100-demo-gold",
        "synthetic": True,
        "seed": args.seed,
        "n_communes": len(communes["code_insee"]),
        "scenarios": list(SCENARIOS),
        "indicators": list(INDICATORS),
        "pivot_years": list(years),
        "schema": {
            "code_insee": "VARCHAR (dictionnaire) — clé de jointure PMTiles <-> Parquet",
            "year": "INT16",
            "hazard_raw": "FLOAT32 — unité selon indicateur (voir hazard_units)",
            "hazard_local_100m": "FLOAT32 — aléa micro-affiné 100 m (pseudo-downscaling démo)",
            "exposure_score": "FLOAT32 0..1",
            "vulnerability_score": "FLOAT32 0..1",
            "composite_risk_score": "FLOAT32 0..1",
        },
        "hazard_units": {
            "heatwave": "jours/an Tmax > 35 °C",
            "rga": "indice retrait-gonflement des argiles 0..10",
            "flooding": "indice d'exposition inondation 0..30",
            "water_stress": "jours/an de stress hydrique (SPI < -1)",
        },
        "composite_formula": "clip(hazard_norm^1.2 * 0.45 + exposure * 0.30 + vulnerability * 0.25, 0, 1) ; hazard_norm = normalisation percentiles 1/99 de hazard_local_100m par indicateur",
        "partitioning": "data/metrics/scenario={scenario}/indicator={indicator}.parquet",
        "parquet": {"compression": "zstd-3", "statistics": True, "dictionary": ["code_insee"]},
        "duckdb_example": "SELECT scenario, code_insee, round(composite_risk_score, 3) FROM read_parquet('data/metrics/*/indicator=heatwave.parquet', hive_partitioning=true) WHERE year = 2050 ORDER BY composite_risk_score DESC LIMIT 20;",
    }
    meta_path = metrics_dir / "_metadata.json"
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    total_mb = sum(p.stat().st_size for p in written) / 1e6
    print(f"\nTerminé en {time.time() - t0:.1f} s — {len(written)} fichiers Parquet ({total_mb:.1f} Mo), métadonnées -> {meta_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

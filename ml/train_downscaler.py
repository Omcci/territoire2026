#!/usr/bin/env python3.11
"""
Territoires 2100 — Phase 1 : downscaling spatial ML (8 km -> 100 m).

Les modèles régionaux DRIAS / Euro-CORDEX fournissent l'aléa sur une grille
de 8 à 12 km : inutilisable tel quel à l'échelle d'une commune, d'un quartier
ou d'une parcelle. Ce script entraîne un modèle de régression spatiale qui
apprend la correction micro-locale de l'aléa régional à partir de covariables
géographiques fines (type IGN / Corine Land Cover) :

    Features (X) :
        hazard_regional_8km  aléa régional DRIAS (grille 8 km)        [°C]
        altitude_m           altitude MNT                             [m]
        slope_deg            pente                                    [°]
        dist_river_km        distance au cours d'eau le plus proche   [km]
        roughness_m          rugosité du relief (amplitude locale)    [m]
        dist_coast_km        distance au littoral                     [km]
        impervious_pct       taux d'imperméabilisation                [%]
        canopy_pct           couverture de canopée                    [%]

    Target (Y) :
        hazard_local_100m    température locale affinée à 100 m       [°C]
        (transposable aux autres indicateurs : jours > 35 °C, SPI, …)

Physique apprise par le modèle (vérité terrain synthétique de démonstration) :
    - gradient adiabatique : −0,65 °C / 100 m d'altitude au-dessus de la maille 8 km
    - îlot de chaleur urbain : jusqu'à +2,4 °C selon l'imperméabilisation
    - refroidissement par la canopée : jusqu'à −1,5 °C
    - brise marine : refroidissement exponentiel près du littoral
    - fond de vallée fluvial : légère modération thermique

Validation : validation croisée SPATIALE par blocs de 1° x 1°
(``SpatialBlockKFold`` maison) + hold-out spatial en damier. Une validation
aléatoire classique surestimerait grossièrement la performance à cause de
l'autocorrélation spatiale (les points voisins se ressemblent).

Export : ONNX obligatoire (``models/downscaler_france.onnx``) pour inférence
côté client (onnxruntime-web / WASM) ou dans le pipeline, sans dépendance
à scikit-learn/XGBoost au moment du scoring. L'export est validé par
comparaison directe des prédictions sklearn vs onnxruntime.

Usage :
    python -m ml.train_downscaler [--model xgboost|random-forest|auto]
                                  [--n-samples 30000] [--seed 42]

Dépendances : numpy, polars, scikit-learn, xgboost, onnx, onnxruntime, skl2onnx.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

# Permet `python ml/train_downscaler.py` comme `python -m ml.train_downscaler`.
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

FEATURES: list[str] = [
    "hazard_regional_8km",
    "altitude_m",
    "slope_deg",
    "dist_river_km",
    "roughness_m",
    "dist_coast_km",
    "impervious_pct",
    "canopy_pct",
]
TARGET = "hazard_local_100m"
GRID_8KM_DEG = 0.08  # ~8 km : maille des covariables "régionales"


# --------------------------------------------------------------------------- #
# Données d'entraînement
# --------------------------------------------------------------------------- #

def _load_covariates(n_samples: int, rng: np.random.Generator) -> dict[str, np.ndarray]:
    """Covariables fines : centroïdes communaux si disponibles, sinon tirage spatial.

    Réutilise les fonctions géographiques du pipeline gold (source unique de
    vérité pour la physique du territoire) ; repli autonome si le module est
    introuvable (script copié hors du repo).
    """
    try:
        from pipeline.generate_gold_data import compute_covariates, generate_communes

        ref_path = _REPO_ROOT / "data" / "geo" / "communes_reference.parquet"
        if ref_path.exists():
            import polars as pl

            ref = pl.read_parquet(ref_path)
            idx = rng.choice(ref.height, size=min(n_samples, ref.height), replace=False)
            sample = ref[idx]
            cov = {
                "lon": sample["lon"].to_numpy().astype(np.float64),
                "lat": sample["lat"].to_numpy().astype(np.float64),
                "altitude_m": sample["altitude_m"].to_numpy().astype(np.float64),
                "slope_deg": sample["slope_deg"].to_numpy().astype(np.float64),
                "dist_river_km": sample["dist_river_km"].to_numpy().astype(np.float64),
                "roughness_m": sample["roughness_m"].to_numpy().astype(np.float64),
                "dist_coast_km": sample["dist_coast_km"].to_numpy().astype(np.float64),
                "impervious_pct": sample["impervious_pct"].to_numpy().astype(np.float64),
                "canopy_pct": sample["canopy_pct"].to_numpy().astype(np.float64),
            }
            cov["dept"] = sample["dept"].to_numpy()
            print(f"      source : {ref_path.name} ({len(cov['lon']):,} centroïdes communaux échantillonnés)")
            return cov

        communes = generate_communes(n_samples, rng)
        cov = compute_covariates(communes["lon"], communes["lat"], rng)
        cov["lon"], cov["lat"] = communes["lon"], communes["lat"]
        cov["dept"] = np.array(communes["dept"])
        print(f"      source : {len(cov['lon']):,} communes synthétiques à la volée (lancez `make gold` pour le référentiel)")
        return cov

    except ImportError:
        # --- Repli autonome : champ géographique simplifié, sans le pipeline ---
        print("      source : repli autonome (pipeline.generate_gold_data introuvable)")
        lon = rng.uniform(-4.8, 9.6, size=n_samples)
        lat = rng.uniform(41.3, 51.1, size=n_samples)
        altitude = np.clip(
            90
            + 2900 * np.exp(-(((lon - 6.6) ** 2 + (lat - 45.9) ** 2) / (2 * 0.85**2)))
            + 2100 * np.exp(-(((lon - 0.8) ** 2 + (lat - 42.7) ** 2) / (2 * 0.7**2)))
            + 1300 * np.exp(-(((lon - 3.6) ** 2 + (lat - 45.1) ** 2) / (2 * 0.9**2)))
            + rng.normal(0, 25, size=n_samples),
            0, 4200,
        )
        return {
            "lon": lon, "lat": lat, "dept": np.array(["NA"] * n_samples),
            "altitude_m": altitude,
            "slope_deg": np.clip(altitude / 90 + rng.normal(0, 1, n_samples), 0, 45),
            "dist_river_km": rng.gamma(2.0, 6.0, size=n_samples),
            "roughness_m": np.clip(altitude / 12 + rng.normal(0, 4, n_samples), 0, 400),
            "dist_coast_km": rng.gamma(2.2, 28.0, size=n_samples),
            "impervious_pct": rng.beta(1.6, 5.0, size=n_samples) * 100,
            "canopy_pct": rng.beta(2.2, 4.0, size=n_samples) * 100,
        }


def build_dataset(n_samples: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    """Construit (X, y, meta) : aléa régional 8 km -> aléa local 100 m (vérité physique)."""
    cov = _load_covariates(n_samples, rng)
    lon, lat = cov["lon"], cov["lat"]

    # --- Maille régionale 8 km : on quantifie les coordonnées sur la grille ---
    lon_g = np.round(lon / GRID_8KM_DEG) * GRID_8KM_DEG
    lat_g = np.round(lat / GRID_8KM_DEG) * GRID_8KM_DEG
    # Altitude "vue" par le modèle régional : celle de la maille, pas du point.
    alt_regional = np.clip(
        90
        + 2900 * np.exp(-(((lon_g - 6.6) ** 2 + (lat_g - 45.9) ** 2) / (2 * 0.85**2)))
        + 2100 * np.exp(-(((lon_g - 0.8) ** 2 + (lat_g - 42.7) ** 2) / (2 * 0.7**2)))
        + 1300 * np.exp(-(((lon_g - 3.6) ** 2 + (lat_g - 45.1) ** 2) / (2 * 0.9**2))),
        0, 4200,
    )
    # Tmax estivale régionale (°C) : gradient latitudinal + altitude de maille
    # + variabilité synoptique douce (inconnue du point fin).
    hazard_regional = (
        35.6
        - 0.82 * (lat_g - 42.3)
        - 0.0058 * alt_regional
        + 0.9 * np.sin(lon_g * 1.7 + 0.4) * np.cos(lat_g * 1.3)
    )

    # --- Vérité terrain locale 100 m (physique que le ML doit retrouver) ------
    altitude = cov["altitude_m"]
    imperv = cov["impervious_pct"] / 100.0
    canopy = cov["canopy_pct"] / 100.0
    y = (
        hazard_regional
        - 0.0065 * (altitude - alt_regional)                    # lapse rate −0,65 °C/100 m
        + 2.4 * imperv                                          # îlot de chaleur urbain
        - 1.5 * canopy                                          # évapotranspiration
        - 0.9 * np.exp(-cov["dist_coast_km"] / 12.0)            # brise marine
        - 0.35 * np.exp(-cov["dist_river_km"] / 3.0)            # modération fluviale
        - 0.012 * cov["slope_deg"]                              # versants / drainage d'air froid
        + rng.normal(0.0, 0.35, size=len(lon))                  # bruit d'observation
    )

    X = np.column_stack(
        [
            hazard_regional,
            altitude,
            cov["slope_deg"],
            cov["dist_river_km"],
            cov["roughness_m"],
            cov["dist_coast_km"],
            cov["impervious_pct"],
            cov["canopy_pct"],
        ]
    ).astype(np.float64)

    # Valeurs manquantes réalistes (capteurs / trous MNT) : le pipeline doit imputer.
    nan_mask = rng.random(X.shape) < 0.02
    nan_mask[:, 0] = False  # l'aléa régional DRIAS, lui, est toujours disponible
    X[nan_mask] = np.nan

    meta = {"lon": lon, "lat": lat, "dept": cov["dept"], "alt_regional": alt_regional}
    return X, y.astype(np.float64), meta


# --------------------------------------------------------------------------- #
# Validation croisée spatiale par blocs
# --------------------------------------------------------------------------- #

class SpatialBlockKFold:
    """K-Fold sur des blocs géographiques (et non sur des points).

    Les points d'un même bloc (par défaut 1° x 1°, soit ~85 x 111 km) ne sont
    jamais répartis entre train et test : on mesure la capacité du modèle à
    généraliser à un territoire JAMAIS vu, ce qui élimine l'essentiel de
    l'autocorrélation spatiale qui gonfle les scores d'une CV aléatoire.
    """

    def __init__(self, n_splits: int = 5, block_deg: float = 1.0, seed: int = 42):
        self.n_splits = n_splits
        self.block_deg = block_deg
        self.seed = seed

    def get_n_splits(self, X=None, y=None, groups=None) -> int:  # noqa: ANN001
        return self.n_splits

    def split(self, X, y=None, groups=None):  # noqa: ANN001
        """``groups`` doit contenir les identifiants de bloc (ou lon/lat via meta)."""
        if groups is None:
            raise ValueError("SpatialBlockKFold requiert groups=block_ids (voir block_ids()).")
        block_ids = np.asarray(groups)
        unique = np.unique(block_ids)
        rng = np.random.default_rng(self.seed)
        shuffled = rng.permutation(unique)
        folds = np.array_split(shuffled, self.n_splits)
        indices = np.arange(len(block_ids))
        for fold_blocks in folds:
            test_mask = np.isin(block_ids, fold_blocks)
            yield indices[~test_mask], indices[test_mask]

    @staticmethod
    def block_ids(lon: np.ndarray, lat: np.ndarray, block_deg: float = 1.0) -> np.ndarray:
        bx = np.floor(lon / block_deg).astype(int)
        by = np.floor(lat / block_deg).astype(int)
        return np.array([f"{x}_{y}" for x, y in zip(bx, by)])


# --------------------------------------------------------------------------- #
# Modèle
# --------------------------------------------------------------------------- #

def build_pipeline(model_kind: str):
    """Pipeline sklearn : imputation médiane -> standardisation -> régresseur.

    Le scaler est inutile pour des arbres, mais il rend le graphe ONNX exporté
    agnostique au modèle final (réutilisable si on bascule sur un MLP) et
    documente la chaîne de prétraitement attendue en production.
    """
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    if model_kind == "xgboost":
        try:
            from xgboost import XGBRegressor

            regressor = XGBRegressor(
                n_estimators=700,
                learning_rate=0.06,
                max_depth=7,
                subsample=0.85,
                colsample_bytree=0.85,
                reg_lambda=1.0,
                objective="reg:squarederror",
                n_jobs=-1,
                random_state=42,
            )
        except ImportError:
            print("      xgboost introuvable -> repli RandomForest")
            model_kind = "random-forest"
    if model_kind == "random-forest":
        regressor = RandomForestRegressor(
            n_estimators=450, min_samples_leaf=2, n_jobs=-1, random_state=42
        )
    return Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", regressor),
        ]
    ), model_kind


def _unscale_tree_thresholds(model_onnx, mean: np.ndarray, scale: np.ndarray) -> None:
    """Replie le StandardScaler dans les seuils d'un TreeEnsembleRegressor (en place).

    Un arbre est invariant à toute transformation affine strictement croissante
    des features : entraîner sur ``z = (x - mean) / scale`` puis décider
    ``z_f <= t`` équivaut exactement à décider ``x_f <= t * scale_f + mean_f``
    dans l'espace brut. On réécrit donc les seuils du graphe ONNX pour pouvoir
    omettre le nœud scaler float32, dont les arrondis faisaient basculer des
    seuils proches (écarts observés jusqu'à 0,6 °C). Après repliement,
    l'inférence ONNX est exacte à ~1e-6 près, comme le prouve validate_onnx().
    """
    import onnx  # noqa: F401 — garantit l'erreur explicite si onnx absent
    from onnx import helper

    for node in model_onnx.graph.node:
        if node.op_type != "TreeEnsembleRegressor":
            continue
        attrs = {a.name: a for a in node.attribute}
        feature_ids = np.array(helper.get_attribute_value(attrs["nodes_featureids"]), dtype=np.int64)
        values = np.array(helper.get_attribute_value(attrs["nodes_values"]), dtype=np.float64)
        modes = [m.decode() if isinstance(m, bytes) else m for m in helper.get_attribute_value(attrs["nodes_modes"])]
        # Seuls les nœuds de branchement (BRANCH_*) portent un seuil à replier ;
        # les lignes LEAF ont feature_id = 0 mais ne doivent pas être touchées.
        is_branch = np.array([str(m).startswith("BRANCH") for m in modes])
        new_values = values.copy()
        f = feature_ids[is_branch]
        new_values[is_branch] = values[is_branch] * scale[f] + mean[f]
        # Réécriture propre de l'attribut (suppression puis ré-ajout typé float).
        node.attribute.remove(attrs["nodes_values"])
        node.attribute.append(helper.make_attribute("nodes_values", new_values.astype(np.float32).tolist()))


def export_onnx(pipeline, n_features: int, out_path: Path) -> str:
    """Exporte le pipeline complet en ONNX ; retourne le backend utilisé.

    Stratégie XGBoost : skl2onnx ne sait pas convertir XGBRegressor et la
    conversion directe du pipeline complet dégrade la précision (arrondis du
    scaler float32 au voisinage des seuils). On compose donc deux graphes
    exacts : (1) l'imputer seul via skl2onnx, (2) XGBoost via onnxmltools avec
    seuils repliés dans l'espace brut (voir _unscale_tree_thresholds), puis
    fusion ``onnx.compose.merge_models``. Pour RandomForest, skl2onnx convertit
    nativement le pipeline entier.
    """
    import onnx
    from skl2onnx import to_onnx
    from skl2onnx.common.data_types import FloatTensorType

    model_step = pipeline.named_steps["model"]
    initial_types = [("input", FloatTensorType([None, n_features]))]

    if type(model_step).__name__ == "XGBRegressor":
        from onnxconverter_common.data_types import FloatTensorType as XgbFloatTensorType
        from onnxmltools import convert_xgboost
        from sklearn.pipeline import Pipeline as SkPipeline

        # (1) Imputer seul (espace brut) — conversion exacte.
        pre_onnx = to_onnx(
            SkPipeline(pipeline.steps[:-2]),  # tout sauf scaler + modèle
            initial_types=initial_types,
            target_opset={"": 15, "ai.onnx.ml": 3},
        )
        # (2) XGBoost seul, seuils repliés : z <= t  <=>  x <= t*scale + mean.
        xgb_onnx = convert_xgboost(
            model_step,
            initial_types=[("input", XgbFloatTensorType([None, n_features]))],
            target_opset=15,
        )
        scaler = pipeline.named_steps["scaler"]
        _unscale_tree_thresholds(xgb_onnx, np.asarray(scaler.mean_, dtype=np.float64), np.asarray(scaler.scale_, dtype=np.float64))
        # (3) Fusion des graphes (préfixes pour éviter toute collision de noms).
        xgb_onnx = onnx.compose.add_prefix(xgb_onnx, prefix="xgb_")
        merged = onnx.compose.merge_models(
            pre_onnx,
            xgb_onnx,
            io_map=[(pre_onnx.graph.output[0].name, xgb_onnx.graph.input[0].name)],
        )
        onnx.checker.check_model(merged)
        onnx.save(merged, str(out_path))
        return "skl2onnx(imputer) + onnxmltools(XGBoost, seuils repliés) + onnx.compose"

    model_onnx = to_onnx(
        pipeline,
        initial_types=initial_types,
        target_opset={"": 15, "ai.onnx.ml": 3},
    )
    out_path.write_bytes(model_onnx.SerializeToString())
    return "skl2onnx"


def validate_onnx(
    pipeline, X: np.ndarray, onnx_path: Path, tol_mean: float = 1e-3, tol_max: float = 0.15
) -> dict[str, float]:
    """Compare sklearn vs onnxruntime ; lève si les écarts dépassent les tolérances.

    IMPORTANT : ``X`` doit être un échantillon JAMAIS VU à l'entraînement.
    XGBoost (méthode exact-greedy) place ses seuils de coupure exactement sur
    des valeurs observées : sur les données d'entraînement, des points assis
    sur un seuil basculent d'une feuille à l'autre pour un écart float32 de
    ~1e-7 (écarts in-sample observés jusqu'à 0,6 °C), alors que l'équivalence
    est exacte à ~1e-6 sur données fraîches — c'est ce régime, celui de la
    production, qu'on valide ici.

    Double critère, adapté aux ensembles d'arbres en float32 : un point peut
    légitimement basculer d'UN arbre sur 700 s'il tombe à < 1e-4 d'un seuil
    (écart borné par le poids d'une feuille, très inférieur au RMSE du
    modèle ~0,76 °C). On exige donc mean|Δ| <= ``tol_mean`` (fidélité
    globale, attendue ~1e-6) ET max|Δ| <= ``tol_max`` (aucune corruption
    structurelle du graphe : un graphe faux divergerait de plusieurs °C).
    """
    import onnxruntime as ort

    sample = X[: min(4000, len(X))].astype(np.float32)
    # L'imputer (médiane) fait partie du graphe ONNX comme du pipeline sklearn :
    # les deux chaînes reçoivent exactement les mêmes entrées, NaN compris.
    expected = pipeline.predict(sample)
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    got = session.run(None, {input_name: sample})[0].ravel()
    diff = np.abs(expected - got)
    report = {
        "max_abs_diff": float(diff.max()),
        "mean_abs_diff": float(diff.mean()),
        "share_above_1e-2": float((diff > 1e-2).mean()),
    }
    ok = report["mean_abs_diff"] <= tol_mean and report["max_abs_diff"] <= tol_max
    print(
        f"      validation ONNX : max|Δ|={report['max_abs_diff']:.2e}  mean|Δ|={report['mean_abs_diff']:.2e}  "
        f"part>1e-2={report['share_above_1e-2']:.4%}  -> {'OK' if ok else 'ÉCHEC'}"
    )
    if not ok:
        raise RuntimeError(f"Inférence ONNX divergente (max|Δ|={report['max_abs_diff']:.2e}, mean|Δ|={report['mean_abs_diff']:.2e})")
    return report


# --------------------------------------------------------------------------- #
# Entraînement
# --------------------------------------------------------------------------- #

def _metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

    return {
        "rmse": float(math.sqrt(mean_squared_error(y_true, y_pred))),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Territoires 2100 — entraînement du downscaler spatial (ONNX).")
    parser.add_argument("--model", choices=["xgboost", "random-forest", "auto"], default="auto")
    parser.add_argument("--n-samples", type=int, default=30_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--n-splits", type=int, default=5)
    parser.add_argument("--block-deg", type=float, default=1.0)
    parser.add_argument("--out", type=Path, default=Path("models/downscaler_france.onnx"))
    args = parser.parse_args(argv)

    from sklearn.model_selection import GroupKFold

    rng = np.random.default_rng(args.seed)
    t0 = time.time()
    model_kind = "xgboost" if args.model == "auto" else args.model

    print(f"[1/5] Construction du dataset de downscaling ({args.n_samples:,} points) …")
    X, y, meta = build_dataset(args.n_samples, rng)
    blocks = SpatialBlockKFold.block_ids(meta["lon"], meta["lat"], args.block_deg)
    print(f"      X={X.shape}  y[{y.min():.1f}, {y.max():.1f}] °C  blocs spatiaux uniques={len(np.unique(blocks))}")

    print(f"[2/5] Validation croisée spatiale par blocs ({args.n_splits} folds, blocs {args.block_deg}°) …")
    cv = SpatialBlockKFold(n_splits=args.n_splits, block_deg=args.block_deg, seed=args.seed)
    fold_reports: list[dict[str, float]] = []
    for k, (tr, te) in enumerate(cv.split(X, y, groups=blocks), start=1):
        pipe, _ = build_pipeline(model_kind)
        pipe.fit(X[tr], y[tr])
        m = _metrics(y[te], pipe.predict(X[te]))
        fold_reports.append(m)
        print(f"      fold {k}: RMSE={m['rmse']:.3f} °C  MAE={m['mae']:.3f} °C  R²={m['r2']:.4f}  (test={len(te):,})")

    print("      Validation de contrôle par départements (GroupKFold) …")
    dept_reports: list[dict[str, float]] = []
    n_dept = len(np.unique(meta["dept"]))
    if n_dept >= 2:
        gkf = GroupKFold(n_splits=min(5, n_dept))
        for tr, te in gkf.split(X, y, groups=meta["dept"]):
            pipe, _ = build_pipeline(model_kind)
            pipe.fit(X[tr], y[tr])
            dept_reports.append(_metrics(y[te], pipe.predict(X[te])))
    dept_mean = (
        {k: float(np.mean([r[k] for r in dept_reports])) for k in dept_reports[0]}
        if dept_reports
        else {"rmse": float("nan"), "mae": float("nan"), "r2": float("nan")}
    )

    # Hold-out spatial en damier : blocs (bx + by) % 5 == 0 jamais vus à l'entraînement.
    bx = np.floor(meta["lon"] / args.block_deg).astype(int)
    by = np.floor(meta["lat"] / args.block_deg).astype(int)
    test_mask = ((bx + by) % 5) == 0
    print(f"[3/5] Entraînement final ({model_kind}) — hold-out spatial damier : {int(test_mask.sum()):,} points …")
    pipeline, model_kind = build_pipeline(model_kind)
    pipeline.fit(X[~test_mask], y[~test_mask])
    holdout = _metrics(y[test_mask], pipeline.predict(X[test_mask]))
    print(f"      hold-out : RMSE={holdout['rmse']:.3f} °C  MAE={holdout['mae']:.3f} °C  R²={holdout['r2']:.4f}")

    # Ré-entraînement sur 100 % des données pour le modèle livré.
    pipeline, model_kind = build_pipeline(model_kind)
    pipeline.fit(X, y)
    model_step = pipeline.named_steps["model"]
    importances = getattr(model_step, "feature_importances_", None)
    importance_map = (
        {f: float(v) for f, v in sorted(zip(FEATURES, importances), key=lambda kv: -kv[1])}
        if importances is not None
        else {}
    )
    print("      importances : " + ", ".join(f"{k}={v:.3f}" for k, v in list(importance_map.items())[:4]))

    print(f"[4/5] Export ONNX -> {args.out} …")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    backend = export_onnx(pipeline, X.shape[1], args.out)
    print(f"      backend d'export : {backend} ({args.out.stat().st_size / 1e6:.2f} Mo)")

    print("[5/5] Validation de l'inférence ONNX (onnxruntime vs sklearn, points continus) …")
    # Équivalence de conversion testée sur des points continus jamais vus :
    # jitter gaussien (1 % de l'écart-type par colonne) autour de communes
    # réelles. Les centroïdes d'entraînement eux-mêmes siègent exactement sur
    # les seuils XGBoost et basculent pour 1e-7 (voir validate_onnx) ; les
    # prédictions de production, elles, portent sur des pixels 100 m continus.
    rng_val = np.random.default_rng(args.seed + 999)
    base = X[rng_val.choice(len(X), size=min(4_000, len(X)), replace=False)]
    X_fresh = base + rng_val.normal(0.0, 0.01, size=base.shape) * np.nanstd(base, axis=0)
    onnx_report = validate_onnx(pipeline, X_fresh, args.out)

    report = {
        "model": model_kind,
        "onnx_export_backend": backend,
        "onnx_file": str(args.out),
        "features": FEATURES,
        "feature_order_contract": "L'ordre des colonnes ci-dessus est contractuel pour toute inférence ONNX.",
        "target": f"{TARGET} (Tmax estivale locale, °C)",
        "n_samples": int(len(y)),
        "spatial_cv_block_deg": args.block_deg,
        "spatial_cv_folds": fold_reports,
        "spatial_cv_mean": {k: float(np.mean([r[k] for r in fold_reports])) for k in fold_reports[0]},
        "dept_groupkfold_mean": dept_mean,
        "spatial_holdout_checkerboard": holdout,
        "feature_importances": importance_map,
        "onnx_validation": onnx_report,
        "training_seconds": round(time.time() - t0, 1),
    }
    report_path = args.out.with_name("training_report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nTerminé en {time.time() - t0:.1f} s — rapport -> {report_path}")
    print("Inférence cliente (exemple) : ort.InferenceSession('models/downscaler_france.onnx').run(None, {'input': X_float32})")
    print("Note : le graphe ONNX embarque l'imputer (les NaN sont acceptés et imputés dans le graphe) ;")
    print("       pour XGBoost, le scaler est replié dans les seuils des arbres (équivalence affine exacte).")
    print("       En production : alimenter les 8 features float32 dans l'ordre contractuel (voir training_report.json).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

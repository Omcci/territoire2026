# Territoires 2100

**An interactive map for reading a changing France, municipality by municipality.**

Territoires 2100 is a territorial and climate storytelling application covering
some 35,000 French municipalities. It combines guided stories, free map
exploration, and per-municipality decision briefs, with a strict editorial
rule: observed data, derived readings, and demonstration simulations are never
presented as the same thing.

The interface is in English by default.

## What you can do

- **Discover 19 guided chapters** — extreme heat, clay shrink-swell, flooding,
  drought, natural-disaster history, property prices, essential services,
  car dependency, and a cross-cutting fragility synthesis.
- **Explore freely** — pick any indicator, overlay additional layers, reorder
  them, and adjust their opacity.
- **Open any municipality** — click a commune on the map and read a short
  brief: the active indicator's main measure, its period, what it does and
  does not measure, and its sources. The clicked feature, the INSEE code,
  the brief, and the camera always refer to the same municipality.

The application opens on a neutral map: no layer is imposed before the user
chooses between the stories and free exploration.

## Indicators and data provenance

| Indicator | Nature | Source | Coverage |
|---|---|---|---|
| Extreme heat, clay shrink-swell, flooding, drought & water | **Demonstration simulation** | Project model — *not an official scientific projection* | Three emissions pathways, 1990-2100 horizons |
| Natural disaster history | Observed | GASPAR / Géorisques (CatNat declarations) | 1982-2025 |
| Property prices | Observed | DGFiP DVF transactions | 2023-2025 |
| Essential services | Observed | INSEE, Base permanente des équipements | 1 January 2025 |
| Households with a car; commuting by car / public transport | Observed | INSEE population census (RP) | 2023 |
| Property prices and disaster history | Derived (exploratory) | DVF × GASPAR cross-reading | Municipal level only |
| Cumulative territorial fragilities | Derived (documented count) | GASPAR + BPE + RP | Observations 2023-2025 |

The fragility synthesis is a **simple equal-weight count**, not a risk score:
a dimension is flagged when a municipality records at least 10 CatNat
declarations since 1982, at most 2 of 7 essential-service categories locally,
or at least 80% of employed workers commuting by car. Each municipality brief
shows the three dimensions with their observed values, rules, and statuses.
Property prices are shown for context and never enter the count.

### Data honesty rules

- No invented values: where a source is silent or the sample is too small
  (fewer than 30 sales, households, or workers), the interface says so
  explicitly instead of substituting an estimate.
- CatNat declarations are administrative recognitions, not a probability of
  future disaster. Service data measure presence in the municipality, not
  distance travelled. Observed indicators have a single vintage and never
  display fake future horizons.

## Architecture

- **Frontend**: React 18 + Vite + TypeScript, Tailwind CSS, Zustand.
- **Map**: MapLibre GL with PMTiles geometries; DuckDB-WASM queries
  partitioned Parquet indicators in the browser — no map server.
- **Geography**: a real commune reference (metropolitan France + Corsica)
  rebuilt from contours already in the repository; the INSEE code, kept as
  a string, is the single join key everywhere.

## Getting started

```bash
npm install
npm run dev        # development server
npm run build      # typecheck + production build
npm run preview    # serve the production build
```

Checks:

```bash
npm run typecheck
npm test           # node:test suites under tests/
```

## Regenerating the data

Generated artifacts (Parquet partitions, PMTiles, reference files) are
git-ignored and reproducible. Raw source downloads live under
`data/sources/` (not committed). With a Python environment in `.venv`:

```bash
.venv/bin/python scripts/build_catnat_partitions.py      # GASPAR -> CatNat
.venv/bin/python scripts/build_dvf_catnat_partitions.py  # DVF x CatNat
.venv/bin/python scripts/build_bpe_partitions.py         # INSEE BPE -> services
.venv/bin/python scripts/build_mobilite_partitions.py    # INSEE RP -> mobility
.venv/bin/python scripts/build_synthese_partitions.py    # fragility count
.venv/bin/python scripts/build_real_reference.py         # commune reference
node scripts/verify_geo_selection.mjs                    # click/selection concordance
```

Each pipeline writes a `*_metadata.json` file documenting its source,
licence, method, and limitations.

## Repository layout

```
src/          React application (map, stories, panels, briefs, store)
src/lib/      Indicator definitions, palettes, brief builders
scripts/      Reproducible data pipelines (Python) and verifiers
tests/        node:test suites (data honesty, geography, briefs, stories)
pipeline/ ml/ Phase 1 synthetic-data and downscaling experiments
data/         Generated artifacts (git-ignored, reproducible)
```

## Known limitations

- The four climate layers remain demonstration simulations; converting them
  to an official projection source (e.g. DRIAS) is future work.
- DVF covers sold homes only and excludes Alsace-Moselle and Mayotte;
  communal geometries are simplified contours, suitable at the map's zooms,
  not parcel-level.
- The synthesis juxtaposes close but distinct vintages (2023, 2025,
  1982-2025); it is a reading of recent observed states, not a snapshot at
  a single date.
- The external basemap (CARTO) is a runtime dependency; if it is
  unavailable, local data still renders on a neutral background with a
  discreet notice.

## Licences of sources

GASPAR / Géorisques, DGFiP DVF, INSEE BPE and RP data are published under
Licence Ouverte / Licence Ouverte 2.0. Official names and dataset
identifiers are preserved as-is in the interface.

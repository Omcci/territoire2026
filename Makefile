PY := .venv/bin/python
.PHONY: setup gold pmtiles train verify all clean

setup: ## Crée le venv Python 3.11 et installe les dépendances
	python3.11 -m venv .venv
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r requirements.txt

gold: ## Génère communes.geojson + GeoParquet partitionné (35 000 communes)
	$(PY) -m pipeline.generate_gold_data

pmtiles: ## Génère france_communes.pmtiles via tippecanoe (requiert `make gold`)
	./pipeline/build_pmtiles.sh

train: ## Entraîne le downscaler et exporte models/downscaler_france.onnx
	$(PY) -m ml.train_downscaler

verify: ## Contrôles bout-en-bout : DuckDB sur GeoParquet + inférence ONNX + PMTiles
	$(PY) scripts/verify.py

all: gold pmtiles train verify ## Pipeline complet Phase 1

clean: ## Supprime les artefacts générés
	rm -rf data/geo/*.geojson data/geo/*.pmtiles data/geo/*.parquet data/metrics models/*.onnx models/*.json

# Supermatrix-AI — Philippine Energy & Mineral Mapper (PHEMM)

This extension layers domain data and job templates on top of the lightweight scaffold so analysts can experiment with supply-curve and geothermal techno-economic runs.

## What's included

- **AOI generator** (`scripts/fetch_ph_aoi.py`) – pulls the Philippines boundary, key provinces, and seed geothermal fields via OpenStreetMap and writes GeoJSON to `data/aoi/`.
- **reV templates** (`configs/rev/*.json`, `project_points.csv`) – minimal PV and wind job definitions pointing at a shared project points table.
- **GEOPHIRES presets** (`configs/geophires/*.txt`) – Leyte, Negros, and Occidental Mindoro scenario files that drop outputs in `vault/geophires_runs/`.
- **FusionLinker pipeline** (`configs/fusionlinker.jobs.yaml`) – orchestrates AOI build → reV points/generation → GEOPHIRES runs and publishes Vault artifacts.
- **Runner script** (`scripts/run_fusionlinker_jobs.sh`) – sequential shell wrapper for local experimentation.

## Quickstart

1. `cd ecosystem/phil_energy_mineral_mapper`
2. Activate your environment (e.g. `source .venv_phemm/bin/activate`) and install the optional helpers: `pip install osmnx==1.9.3 pandas==2.2.2 geopandas`
3. Populate `modules/reV` and `modules/GEOPHIRES-X` with the upstream projects.
4. Execute `./scripts/run_fusionlinker_jobs.sh`
5. Inspect outputs in `vault/` or via the FastAPI endpoint (`http://127.0.0.1:8099/layers`).

## Customise

- Update `configs/rev/project_points.csv` and job JSONs for different years, technologies, or analysis options.
- Replace the AOI GeoJSON with DOE/MGB official boundaries when available.
- Duplicate and tune the GEOPHIRES config files for additional prospects.
- Hook the generated vault outputs into downstream analytics or dashboards.

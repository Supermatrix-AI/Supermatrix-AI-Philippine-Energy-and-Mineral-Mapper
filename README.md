# Supermatrix-AI: Philippine Energy & Mineral Mapper

## Summary
Supermatrix-AI fuses NASA, ESA, and partner Earth Observation stacks into explainable mineral and energy prospectivity layers for the Philippines. The latest release adds:

* **Expanded targets** – gold, silver, platinum, copper, nickel, iron, rare earth elements, oil & gas, geothermal, and a MegaFusion composite with consensus/confidence rasters.
* **Sensor-aware resilience** – each dataset carries availability metadata so downstream models can understand where gaps exist (inspired by USGS & MapBiomas QA layers).
* **Field-ready sampling CLI** – a Python utility that mirrors open-source exploration pipelines (Radiant Earth / Overture-like) to build training tables with spectral indices, terrain, SAR texture, EMIT summaries, GRACE, SMAP, and per-pixel availability scores.

All outputs remain *proxies* that require validation with ground geology, indigenous community consultation, and regulatory review before any decision-making.

## Repository structure

| Path | Description |
| --- | --- |
| `data/gee_scripts/PH_MegaFusion_map.js` | Earth Engine workflow for multi-target prospectivity, exports, and confidence layers. |
| `data/scripts/mineral_ai_preprocessor.py` | Python CLI for harvesting labeled samples with multi-sensor feature stacks. |
| `data/demo/` | Placeholder for generated CSVs/visual assets. |

## Running the Earth Engine mapper

1. Open [`data/gee_scripts/PH_MegaFusion_map.js`](data/gee_scripts/PH_MegaFusion_map.js) inside the [Google Earth Engine Code Editor](https://code.earthengine.google.com/).
2. Adjust the Area of Interest (AOI) if needed (default is the entire Philippines).
3. Click **Run**.
4. Inspect layers:
   * Metals + critical minerals (0–1 scale)
   * Hydrocarbon & geothermal proxies
   * MegaFusion composite + Fusion Confidence + Sensor Availability
5. Use the **Inspector** tool to explore pixel-level signatures or the **Tasks** tab to launch Drive exports:
   * Hotspot CSV (top targets per class, with centroid, area, heuristic depth & volume)
   * 100 m potential rasters for every target + fusion confidence
   * 1 km sensor availability QA raster

### Responsible-AI guardrails in the mapper

* Every dataset is wrapped in safe loaders with fallback placeholders and availability flags (modeled on MapBiomas & NOAA EMP best practices).
* Consensus × availability confidence surfaces highlight where claims must remain cautious.
* Print statements reiterate validation expectations (ground truth, geophysics, socio-environmental review).

## Sampling training data with the Python CLI

The CLI brings the mapper’s philosophy into an offline workflow for experimentation, benchmarking, or model training.

```bash
python data/scripts/mineral_ai_preprocessor.py sample \
  --aoi-name "Northern Mindanao" \
  --start-date 2022-01-01 --end-date 2024-12-31 \
  --output-csv data/demo/mindanao_samples.csv
```

Key capabilities:

* Uses GAUL administrative boundaries (levels 0–2) or custom AOIs (GeoJSON / EE asset).
* Computes Sentinel-2 indices (NDVI, NDWI, clay, iron, silica) with cloud-masking inspired by ESA Sen2Cor recipes.
* Adds terrain (SRTM), Sentinel-1 SAR texture, EMIT mineral summaries, EMAG2 magnetics, GRACE water mass, SMAP soil moisture, and a data-availability QA band.
* Outputs:
  * CSV table of samples (default 5 000 pixels @ 30 m, reproducible via seed)
  * Metadata JSON with AOI area, bands used, availability report, and configuration snapshot

See `python data/scripts/mineral_ai_preprocessor.py sample --help` for the full list of switches (e.g., disable SAR, change band lists, or skip temporal stats).

## Data sources referenced

* NASA: EMIT, ECOSTRESS, GEDI, GRACE, SMAP, SRTM
* NOAA: VIIRS Nighttime Lights, EMAG2
* ESA/Copernicus: Sentinel-1, Sentinel-2
* USGS: Landsat Collection 2
* JAXA: ALOS AW3D30

Many were highlighted in NASA’s Applied Sciences mineral mapping studies and open-source repositories (e.g., SERVIR, NASA-IMPACT Mineral Mapping Playbooks).

## Validation & ethical deployment checklist

1. **Ground validation** – field spectroscopy, drilling, geochemical assays (ICP-MS), and consultation with DENR/MGB.
2. **Community engagement** – align with local stakeholders, ancestral domain rights, and climate resilience plans.
3. **Feedback loop** – feed validated hotspots back into the CLI sampling workflow for retraining and calibration.
4. **Versioning** – document sensor availability + algorithm choices when sharing outputs (metadata JSON + map printouts).

## 🌐 Project demonstration
* 🔗 [Project Demo (Google Drive)](https://your-public-demo-link)
* 📘 [NASA Space Apps Challenge Submission Page](https://www.spaceappschallenge.org)

## 🛰️ About
Developed for the *2025 NASA Space Apps Challenge*, blending NASA Earth datasets with explainable AI heuristics so government, academia, and civil society partners can prototype resilient energy & mineral intelligence for the Philippine archipelago.

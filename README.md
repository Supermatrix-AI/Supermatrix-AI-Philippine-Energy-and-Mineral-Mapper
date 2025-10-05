# Supermatrix-AI: Philippine Energy & Mineral Mapper

## Summary
AI-assisted mapper that fuses NASA & partner Earth Observation datasets to create mineral and energy proxy maps across the Philippines. Outputs: per-pixel proxies (gold, silver, copper, REE, oil/gas, geothermal), MegaFusion composite, hotspot CSV.

## How to run
1. Open the GEE script gee_scripts/PH_MegaFusion_map.js in Earth Engine Code Editor.
2. Press Run.
3. Use Inspector to read pixel values. Use Tasks panel to export maps & CSV.

## Files
- gee_scripts/PH_MegaFusion_map.js — Earth Engine script (main)
- demo/ — slides or demo video link
- data/ — placeholder for Philippine datasets (to be uploaded to GEE assets)

## Notes
All outputs are proxies. Field validation is required before any operational use.

# PHEMM External Modules

The PHEMM workspace integrates a set of upstream research projects for renewable energy and mineral exploration workflows. The
repositories are **not** vendored in this repository; clone or download the releases manually if you need the full capability.
Place each project inside the matching subdirectory below before running any pipelines or FusionLinker routes.

| Directory | Upstream project | Notes |
|-----------|------------------|-------|
| `reV/` | https://github.com/NREL/reV | Renewable energy resource and supply-curve modeling. Requires Python >=3.9 and extensive dependencies. |
| `GEOPHIRES-X/` | https://github.com/NREL/GEOPHIRES-X | Techno-economic geothermal simulator. Invoke with `python GEOPHIRES_X.py`. |
| `geothermal_osr/` | https://github.com/NREL/geothermal_osr | Machine learning workflows for geothermal potential. |
| `gempy/` | https://github.com/gempy-project/gempy | 3D geological modeling toolkit. Install extras such as `gempy[base]`. |
| `ASTER_pre/` | https://github.com/Mining-for-the-Future/ASTER_preprocessing | ASTER spectral indices preprocessing used with Google Earth Engine. |
| `GeoMining_EE_Hops/` | https://github.com/neriiacopo/GeoMining-EE-Hops | Earth Engine automation patterns for mineral mapping. |
| `gee_apps_idx/` | https://github.com/philippgaertner/awesome-earth-engine-apps | Inspiration index for GEE applications. |
| `minex_ml/` | https://github.com/RichardScottOZ/mineral-exploration-machine-learning | Machine learning references for mineral exploration. |

Each directory currently contains only this placeholder README to keep the repository self-contained. Populate them with the
upstream sources if your local policy permits network access and the relevant licenses.

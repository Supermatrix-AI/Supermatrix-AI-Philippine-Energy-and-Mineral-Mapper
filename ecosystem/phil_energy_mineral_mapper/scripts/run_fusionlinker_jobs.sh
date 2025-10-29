#!/usr/bin/env bash
set -euo pipefail

if [ -d .venv_phemm ]; then
  source .venv_phemm/bin/activate
fi

has_module() {
  local module="$1"
  python - "$module" <<'PY'
import importlib.util
import sys
mod = sys.argv[1]
sys.exit(0 if importlib.util.find_spec(mod) else 1)
PY
}

echo "▶ AOI build"
python scripts/fetch_ph_aoi.py || true

echo "▶ reV solar points"
if has_module "reV"; then
  (cd modules/reV && python -m reV.supply_curve.cli_sc_point_extractor -o ../../vault/reV_runs/solar_points.csv -p ../../configs/rev/project_points.csv)
else
  echo "⚠️ reV not installed locally; skipping supply-curve extraction"
fi

echo "▶ reV solar gen"
if has_module "reV"; then
  (cd modules/reV && python -m reV.generation.cli_generation -c ../../configs/rev/rev_solar_job.json || true)
else
  echo "⚠️ reV not installed locally; skipping generation job"
fi

echo "▶ reV wind points"
if has_module "reV"; then
  (cd modules/reV && python -m reV.supply_curve.cli_sc_point_extractor -o ../../vault/reV_runs/wind_points.csv -p ../../configs/rev/project_points.csv)
else
  echo "⚠️ reV not installed locally; skipping supply-curve extraction"
fi

echo "▶ reV wind gen"
if has_module "reV"; then
  (cd modules/reV && python -m reV.generation.cli_generation -c ../../configs/rev/rev_wind_job.json || true)
else
  echo "⚠️ reV not installed locally; skipping generation job"
fi

echo "▶ GEOPHIRES Leyte"
if [ -f modules/GEOPHIRES-X/GEOPHIRES_X.py ]; then
  (cd modules/GEOPHIRES-X && python GEOPHIRES_X.py ../../configs/geophires/leyte_tongonan.txt || true)
else
  echo "⚠️ GEOPHIRES-X not present; skipping"
fi

echo "▶ GEOPHIRES Negros"
if [ -f modules/GEOPHIRES-X/GEOPHIRES_X.py ]; then
  (cd modules/GEOPHIRES-X && python GEOPHIRES_X.py ../../configs/geophires/negros_palinpinon.txt || true)
else
  echo "⚠️ GEOPHIRES-X not present; skipping"
fi

echo "▶ GEOPHIRES Mindoro"
if [ -f modules/GEOPHIRES-X/GEOPHIRES_X.py ]; then
  (cd modules/GEOPHIRES-X && python GEOPHIRES_X.py ../../configs/geophires/mindoro_occidental.txt || true)
else
  echo "⚠️ GEOPHIRES-X not present; skipping"
fi

echo "✅ Done. Browse vault/ for outputs."

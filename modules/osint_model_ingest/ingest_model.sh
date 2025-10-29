#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR="$SCRIPT_DIR/xyz-mineral-mapper"

if [ ! -d "$REPO_DIR" ]; then
  echo "Cloning OSINT model repository..."
  git clone https://github.com/EXAMPLE/xyz-mineral-mapper.git "$REPO_DIR"
else
  echo "Updating existing OSINT model repository..."
  git -C "$REPO_DIR" pull --ff-only
fi

cd "$REPO_DIR"

if [ -f requirements.txt ]; then
  echo "Installing Python requirements"
  pip install -r requirements.txt
fi

echo "Running model to produce sample output"
python run_model.py --mode predict \
  --input "$SCRIPT_DIR/data/aoi/PH_country.geojson" \
  --output "$SCRIPT_DIR/../../vault/osint_model_output/PH_model_pred.tif"

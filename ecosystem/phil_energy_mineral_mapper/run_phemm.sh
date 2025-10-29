#!/usr/bin/env bash
set -euo pipefail
source .venv_phemm/bin/activate
echo "[1/3] API → http://127.0.0.1:8099/health"
uvicorn services.api.main:app --port 8099 --reload &
API_PID=$!
sleep 2
echo "[2/3] Notebooks → launch with: jupyter lab"
echo "[3/3] Modules wired. Edit configs/fusionlinker.phemm.yaml or configs/fusionlinker.jobs.yaml and run routes via FusionLinker."
echo "      For a local dry-run pipeline, execute: ./scripts/run_fusionlinker_jobs.sh"
wait $API_PID

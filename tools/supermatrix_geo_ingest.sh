#!/usr/bin/env bash
#
# supermatrix_geo_ingest.sh
# Ingest open-source geospatial/mineral-prospectivity repositories into SUPERMATRIX VaultSync
#
set -euo pipefail

# Configuration
VAULT_DIR="${HOME}/supermatrix_vault"             # base directory for all ingestion
REPOS_DIR="${VAULT_DIR}/repos"                    # location for cloned repositories
METADATA_LOG="${VAULT_DIR}/ingest_metadata.log"   # log of ingest operations

mkdir -p "${REPOS_DIR}"
touch "${METADATA_LOG}"

# List of repositories to ingest
declare -A REPOS
REPOS["EIS_Toolkit"]="https://github.com/GispoCoding/eis_toolkit.git"
REPOS["MineralProspectivityML"]="https://github.com/Abdallah-M-Ali/Mineral-Prospectivity-Mapping-ML.git"
REPOS["EMIT_Data_Resources"]="https://github.com/nasa/EMIT-Data-Resources.git"
REPOS["Awesome_Mining_Data"]="https://github.com/Arpeggeo/awesome-mining-data.git"
REPOS["Prospectivity_Gawler"]="https://github.com/EarthByte/MPM_Gawler.git"

# Record start time
echo "$(date +'%Y-%m-%d %H:%M:%S') — Starting ingestion run" >> "${METADATA_LOG}"

for name in "${!REPOS[@]}"; do
  url="${REPOS[$name]}"
  target="${REPOS_DIR}/${name}"
  echo "→ Ingesting ${name} from ${url}"
  
  if [ -d "${target}" ]; then
    echo "   -- Repository already cloned. Pulling latest updates."
    git -C "${target}" fetch --all
    git -C "${target}" pull --ff-only
  else
    echo "   -- Cloning into ${target}"
    git clone "${url}" "${target}"
  fi

  # Register metadata
  commit_hash=$(git -C "${target}" rev-parse HEAD)
  echo "$(date +'%Y-%m-%d %H:%M:%S') | ${name} | ${url} | ${commit_hash}" >> "${METADATA_LOG}"

  # Optionally perform initial indexing/staging for VaultSync
  # (example: create a manifest file, copy datasets, tag version)
  if [ -x "${target}/ingest.sh" ]; then
    echo "   -- Running repository-provided ingest script"
    cd "${target}"
    ./ingest.sh --dest "${VAULT_DIR}/datasets/${name}"
    cd -
  else
    echo "   -- No ingest.sh found; registering repository for manual integration"
  fi

done

# Update central STAC catalog registration (example placeholder)
echo "Updating STAC catalog at ${VAULT_DIR}/stac_catalog.json"
# (Here you would call your Python/Node script to scan repos and update STAC records)

echo "$(date +'%Y-%m-%d %H:%M:%S') — Ingestion run completed" >> "${METADATA_LOG}"

echo "Ingestion complete. Please review ${METADATA_LOG} for details."

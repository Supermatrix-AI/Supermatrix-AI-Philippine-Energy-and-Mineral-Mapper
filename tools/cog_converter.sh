#!/usr/bin/env bash
set -euo pipefail

echo "Converting all GeoTIFFs in vault/ to Cloud-Optimized GeoTIFFs (COG) and applying style JSON metadata"

find vault/ -type f -name "*.tif" | while read -r tif; do
  rel_path=${tif#vault/}
  out_dir="vault_cog/$(dirname "$rel_path")"
  mkdir -p "$out_dir"
  out="${out_dir}/$(basename "${tif}" .tif)_cog.tif"
  gdal_translate "$tif" "$out" -of COG -co COMPRESS=DEFLATE -co TILING_SCHEME=GoogleMapsCompatible
  style_json="${out%.*}_style.json"
  cat <<EOF > "$style_json"
{"style": "styler_default", "source": "${out}"}
EOF
  echo "Converted $tif -> $out"
done

"""Utility CLI for sampling multi-sensor stacks for Supermatrix-AI models.

This script extends the quick prototype sampler into a configurable pipeline that
mirrors open-source mineral targeting toolkits (e.g., USGS Spectral Library
workflows, Planetary Computer recipes) while staying lightweight for NASA Space
Apps experimentation.

Usage examples:
    python mineral_ai_preprocessor.py sample \
        --aoi-name "Northern Mindanao" \
        --start-date 2022-01-01 --end-date 2024-12-31 \
        --output-csv data/demo/mindanao_samples.csv

    python mineral_ai_preprocessor.py sample \
        --aoi-level 0 --aoi-name Philippines \
        --bands B2 B3 B4 B8 --skip-s1
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import ee
import geemap
import pandas as pd


GAUL_DATASET_TEMPLATE = "FAO/GAUL/2015/level{level}"
GAUL_FIELD_BY_LEVEL = {0: "ADM0_NAME", 1: "ADM1_NAME", 2: "ADM2_NAME"}
DEFAULT_OUTPUT_CSV = Path("data/demo/supermatrix_samples.csv")
DEFAULT_BANDS = ["B2", "B3", "B4", "B5", "B6", "B7", "B8", "B11", "B12"]


def initialize_earth_engine() -> None:
    """Initialise EE, prompting for authentication if needed."""
    try:
        ee.Initialize()
    except Exception:  # pragma: no cover - EE handles auth prompts interactively
        ee.Authenticate()
        ee.Initialize()


def asset_exists(asset_id: str) -> bool:
    try:
        ee.data.getInfo(asset_id)
        return True
    except Exception:
        return False


def availability_flag(condition: ee.ComputedObject) -> ee.Image:
    return ee.Image(ee.Algorithms.If(condition, ee.Image.constant(1), ee.Image.constant(0)))


def safe_band(image: ee.Image, band: str, default: float = 0.0) -> ee.Image:
    band_name = ee.String(band)
    bands = image.bandNames()
    has_band = bands.contains(band_name)
    return ee.Image(
        ee.Algorithms.If(
            has_band,
            image.select([band_name]),
            ee.Image.constant(default).rename(band_name),
        )
    )


def safe_normalized_difference(image: ee.Image, band_pair: Iterable[str], name: str) -> ee.Image:
    band_list = ee.List(list(band_pair))
    bands = image.bandNames()
    availability = ee.Number(
        ee.List(band_list.map(lambda b: bands.contains(ee.String(b)))).reduce(ee.Reducer.allNonZero())
    )
    nd = image.normalizedDifference(band_list)
    nd01 = nd.add(1).divide(2).rename(name)
    return ee.Image(ee.Algorithms.If(availability.gt(0), nd01, ee.Image.constant(0).rename(name)))


def safe_ratio(image: ee.Image, num_band: str, den_band: str, name: str) -> ee.Image:
    band_list = ee.List([num_band, den_band])
    bands = image.bandNames()
    availability = ee.Number(
        ee.List(band_list.map(lambda b: bands.contains(ee.String(b)))).reduce(ee.Reducer.allNonZero())
    )
    numerator = safe_band(image, num_band)
    denominator = safe_band(image, den_band)
    ratio = numerator.subtract(denominator).divide(numerator.add(denominator).add(1e-6))
    ratio01 = ratio.add(1).divide(2).rename(name)
    return ee.Image(ee.Algorithms.If(availability.gt(0), ratio01, ee.Image.constant(0).rename(name)))


def mask_sentinel2_clouds(image: ee.Image) -> ee.Image:
    qa = image.select("QA60")
    cloud_bit_mask = 1 << 10
    cirrus_bit_mask = 1 << 11
    mask = qa.bitwiseAnd(cloud_bit_mask).eq(0).And(qa.bitwiseAnd(cirrus_bit_mask).eq(0))
    return image.updateMask(mask).divide(10000)


def compute_indices(image: ee.Image) -> ee.Image:
    indices = [
        safe_normalized_difference(image, ["B8", "B4"], "NDVI"),
        safe_normalized_difference(image, ["B3", "B8"], "NDWI"),
        safe_ratio(image, "B11", "B12", "ClayIndex"),
        safe_ratio(image, "B4", "B2", "IronOxideIndex"),
        safe_ratio(image, "B8", "B11", "SilicaIndex"),
    ]
    return ee.Image.cat(indices)


def terrain_features(aoi: ee.FeatureCollection) -> ee.Image:
    dem = ee.Image("USGS/SRTMGL1_003").clip(aoi)
    slope = ee.Terrain.slope(dem).divide(90).rename("slope_norm")
    aspect = ee.Terrain.aspect(dem).divide(360).rename("aspect_norm")
    return dem.rename("elevation")\
        .addBands(slope)\
        .addBands(aspect)


def sentinel1_features(aoi: ee.FeatureCollection, start: str, end: str) -> Tuple[ee.Image, ee.Image, bool]:
    if not asset_exists("COPERNICUS/S1_GRD"):
        return ee.Image.constant(0).rename("S1_VV_minus_VH"), ee.Image.constant(0).rename("S1_quality"), False

    collection = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(aoi)
        .filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
    )
    availability = collection.size().gt(0)
    median = ee.Image(collection.median().clip(aoi))
    vv = safe_band(median, "VV", default=-20)
    vh = safe_band(median, "VH", default=-25)
    ratio = vv.subtract(vh).divide(30).add(0.5).clamp(0, 1).rename("S1_VV_minus_VH")
    quality = availability_flag(availability).rename("S1_quality")
    return ratio, quality, bool(collection.size().getInfo() > 0)


def emit_features(aoi: ee.FeatureCollection, start: str, end: str) -> Tuple[ee.Image, bool]:
    asset_id = "NASA/EMIT/SurfaceMineralogy"
    if not asset_exists(asset_id):
        return ee.Image.constant(0).rename("EMIT_mean"), False

    collection = ee.ImageCollection(asset_id).filterBounds(aoi).filterDate(start, end)
    availability = collection.size().gt(0)
    mean_img = ee.Image(collection.mean().clip(aoi)).reduce(ee.Reducer.mean()).rename("EMIT_mean")
    mean_img = mean_img.where(mean_img.lt(0), 0)
    return ee.Image(ee.Algorithms.If(availability, mean_img, ee.Image.constant(0).rename("EMIT_mean"))), bool(collection.size().getInfo() > 0)


@dataclass
class SamplingConfig:
    asset_id: str
    start_date: str
    end_date: str
    bands: List[str]
    scale: int
    sample_count: int
    random_seed: int
    include_indices: bool
    include_terrain: bool
    include_s1: bool
    include_emit: bool
    include_temporal_stats: bool
    aoi_level: int
    aoi_name: str
    aoi_country: str
    aoi_asset: str | None
    geojson: Path | None
    output_csv: Path
    output_metadata: Path

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> "SamplingConfig":
        output_csv = Path(args.output_csv) if args.output_csv else DEFAULT_OUTPUT_CSV
        output_metadata = Path(args.metadata) if args.metadata else output_csv.with_suffix(".metadata.json")
        return cls(
            asset_id=args.asset,
            start_date=args.start_date,
            end_date=args.end_date,
            bands=args.bands or DEFAULT_BANDS,
            scale=args.scale,
            sample_count=args.sample_count,
            random_seed=args.random_seed,
            include_indices=not args.skip_indices,
            include_terrain=not args.skip_terrain,
            include_s1=not args.skip_s1,
            include_emit=not args.skip_emit,
            include_temporal_stats=not args.skip_temporal_stats,
            aoi_level=args.aoi_level,
            aoi_name=args.aoi_name,
            aoi_country=args.aoi_country,
            aoi_asset=args.aoi_asset,
            geojson=Path(args.geojson) if args.geojson else None,
            output_csv=output_csv,
            output_metadata=output_metadata,
        )


def resolve_aoi(config: SamplingConfig) -> ee.FeatureCollection:
    if config.geojson:
        if not config.geojson.exists():
            raise FileNotFoundError(f"GeoJSON file not found: {config.geojson}")
        return geemap.geojson_to_ee(str(config.geojson))

    if config.aoi_asset:
        return ee.FeatureCollection(config.aoi_asset)

    dataset = GAUL_DATASET_TEMPLATE.format(level=config.aoi_level)
    field = GAUL_FIELD_BY_LEVEL.get(config.aoi_level, GAUL_FIELD_BY_LEVEL[1])
    collection = ee.FeatureCollection(dataset)
    filters = [ee.Filter.eq(field, config.aoi_name)]
    if config.aoi_level > 0 and config.aoi_country:
        filters.append(ee.Filter.eq("ADM0_NAME", config.aoi_country))
    aoi = collection.filter(filters[0])
    if len(filters) > 1:
        aoi = aoi.filter(filters[1])
    count = aoi.size().getInfo()
    if count == 0:
        raise ValueError(
            f"No GAUL features found for level={config.aoi_level}, name={config.aoi_name}, country={config.aoi_country}"
        )
    return aoi


def build_sampling_stack(config: SamplingConfig, aoi: ee.FeatureCollection) -> Tuple[ee.Image, Dict[str, bool]]:
    availability_reports: Dict[str, bool] = {}
    availability_images: List[ee.Image] = []

    collection = (
        ee.ImageCollection(config.asset_id)
        .filterBounds(aoi)
        .filterDate(config.start_date, config.end_date)
    )
    if config.asset_id == "COPERNICUS/S2_SR":
        collection = collection.map(mask_sentinel2_clouds)

    base_count = collection.size()
    availability_images.append(availability_flag(base_count.gt(0)))
    availability_reports[config.asset_id] = bool(base_count.getInfo() > 0)
    base_image = ee.Image(collection.median().clip(aoi))
    stack = base_image.select(config.bands)

    derived_images: List[ee.Image] = []

    if config.include_indices:
        derived_images.append(compute_indices(base_image))

    if config.include_temporal_stats:
        temporal_std = collection.select(config.bands).reduce(ee.Reducer.stdDev())
        temporal_std = temporal_std.rename([f"{b}_stdDev" for b in config.bands])
        derived_images.append(temporal_std)

    if config.include_terrain:
        terrain = terrain_features(aoi)
        derived_images.append(terrain)
        availability_images.append(availability_flag(ee.Number(1)))
        availability_reports["USGS/SRTMGL1_003"] = True

    if config.include_s1:
        s1_ratio, s1_quality, available = sentinel1_features(aoi, config.start_date, config.end_date)
        derived_images.append(s1_ratio)
        derived_images.append(s1_quality)
        availability_images.append(availability_flag(ee.Number(int(available))))
        availability_reports["COPERNICUS/S1_GRD"] = available

    if config.include_emit:
        emit_mean, available_emit = emit_features(aoi, config.start_date, config.end_date)
        derived_images.append(emit_mean)
        availability_images.append(availability_flag(ee.Number(int(available_emit))))
        availability_reports["NASA/EMIT/SurfaceMineralogy"] = available_emit

    if asset_exists("NOAA/NGDC/EMAG2_2"):
        emag = ee.Image("NOAA/NGDC/EMAG2_2").clip(aoi)
        emag_norm = emag.abs().divide(200).rename("EMAG2_norm")
        derived_images.append(emag_norm)
        availability_images.append(availability_flag(ee.Number(1)))
        availability_reports["NOAA/NGDC/EMAG2_2"] = True
    else:
        availability_reports["NOAA/NGDC/EMAG2_2"] = False

    if asset_exists("NASA/GRACE/MASS_GRIDS"):
        grace = ee.ImageCollection("NASA/GRACE/MASS_GRIDS").filterBounds(aoi).filterDate(config.start_date, config.end_date)
        grace_mean = grace.mean().clip(aoi)
        lwe = safe_band(grace_mean, "lwe_thickness_csr")
        derived_images.append(lwe.abs().divide(50).rename("GRACE_water"))
        availability_images.append(availability_flag(grace.size().gt(0)))
        availability_reports["NASA/GRACE/MASS_GRIDS"] = bool(grace.size().getInfo() > 0)
    else:
        availability_reports["NASA/GRACE/MASS_GRIDS"] = False

    if asset_exists("NASA_USDA/HSL/SMAP_soil_moisture"):
        smap = ee.ImageCollection("NASA_USDA/HSL/SMAP_soil_moisture").filterBounds(aoi).filterDate(config.start_date, config.end_date)
        smap_mean = smap.mean().clip(aoi)
        soil = safe_band(smap_mean, "susm")
        derived_images.append(soil.divide(0.6).clamp(0, 1).rename("SMAP_moisture"))
        availability_images.append(availability_flag(smap.size().gt(0)))
        availability_reports["NASA_USDA/HSL/SMAP_soil_moisture"] = bool(smap.size().getInfo() > 0)
    else:
        availability_reports["NASA_USDA/HSL/SMAP_soil_moisture"] = False

    if derived_images:
        stack = stack.addBands(ee.Image.cat(derived_images))

    if availability_images:
        availability_stack = ee.ImageCollection(availability_images).sum().divide(len(availability_images))
        stack = stack.addBands(availability_stack.rename("data_availability"))

    return stack, availability_reports


def sample_stack(config: SamplingConfig, stack: ee.Image, aoi: ee.FeatureCollection) -> pd.DataFrame:
    region = aoi.geometry()
    sample = stack.sample(
        region=region,
        scale=config.scale,
        numPixels=config.sample_count,
        seed=config.random_seed,
        geometries=True,
    )
    df = geemap.ee_to_pandas(sample, project=True)
    if df.empty:
        raise RuntimeError("Sampling returned an empty dataframe. Try increasing the date range or AOI size.")
    return df


def write_outputs(config: SamplingConfig, df: pd.DataFrame, stack: ee.Image, aoi: ee.FeatureCollection, availability: Dict[str, bool]) -> None:
    config.output_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(config.output_csv, index=False)

    config_payload = asdict(config)
    config_payload["output_csv"] = str(config.output_csv)
    config_payload["output_metadata"] = str(config.output_metadata)
    if config.geojson:
        config_payload["geojson"] = str(config.geojson)

    availability_mean_value = stack.select("data_availability").reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=aoi.geometry(),
        scale=config.scale,
        maxPixels=1e9,
    ).get("data_availability")
    if availability_mean_value is not None:
        availability_mean_value = ee.Number(availability_mean_value).getInfo()

    metadata = {
        "config": config_payload,
        "bands": stack.bandNames().getInfo(),
        "record_count": len(df),
        "aoi_area_sq_km": aoi.geometry().area().divide(1e6).getInfo(),
        "data_availability_mean": availability_mean_value,
        "assets_present": availability,
    }
    config.output_metadata.parent.mkdir(parents=True, exist_ok=True)
    with config.output_metadata.open("w", encoding="utf-8") as fh:
        json.dump(metadata, fh, indent=2, sort_keys=True)

    print(f"Exported {len(df)} samples -> {config.output_csv}")
    print(f"Metadata saved -> {config.output_metadata}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Supermatrix-AI geospatial sampling helper")
    subparsers = parser.add_subparsers(dest="command")

    sample = subparsers.add_parser("sample", help="Sample pixels for model training")
    sample.add_argument("--asset", default="COPERNICUS/S2_SR", help="Image collection to sample")
    sample.add_argument("--start-date", default="2021-01-01", help="Start date (YYYY-MM-DD)")
    sample.add_argument("--end-date", default="2024-12-31", help="End date (YYYY-MM-DD)")
    sample.add_argument("--bands", nargs="*", default=DEFAULT_BANDS, help="Bands to keep from the base image")
    sample.add_argument("--scale", type=int, default=30, help="Sampling scale in meters")
    sample.add_argument("--sample-count", type=int, default=5000, help="Number of random pixels to sample")
    sample.add_argument("--random-seed", type=int, default=42, help="Random seed for repeatability")
    sample.add_argument("--aoi-level", type=int, default=1, choices=[0, 1, 2], help="GAUL admin level (0-country,1-province,2-municipality)")
    sample.add_argument("--aoi-name", default="Northern Mindanao", help="Name of the administrative unit or custom AOI")
    sample.add_argument("--aoi-country", default="Philippines", help="Country filter for GAUL levels >0")
    sample.add_argument("--aoi-asset", help="Optional EE asset ID for AOI feature collection")
    sample.add_argument("--geojson", help="Optional local GeoJSON path for AOI")
    sample.add_argument("--output-csv", help="Path for the CSV export")
    sample.add_argument("--metadata", help="Optional path for metadata JSON")
    sample.add_argument("--skip-indices", action="store_true", help="Disable spectral index computation")
    sample.add_argument("--skip-terrain", action="store_true", help="Disable terrain bands (SRTM)")
    sample.add_argument("--skip-s1", action="store_true", help="Disable Sentinel-1 features")
    sample.add_argument("--skip-emit", action="store_true", help="Disable EMIT mineral summary")
    sample.add_argument("--skip-temporal-stats", action="store_true", help="Disable temporal std-dev bands")

    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
        raise SystemExit(1)
    return args


def main() -> None:
    args = parse_args()
    if args.command == "sample":
        initialize_earth_engine()
        config = SamplingConfig.from_args(args)
        aoi = resolve_aoi(config)
        stack, availability = build_sampling_stack(config, aoi)
        df = sample_stack(config, stack, aoi)
        write_outputs(config, df, stack, aoi, availability)
    else:
        raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()

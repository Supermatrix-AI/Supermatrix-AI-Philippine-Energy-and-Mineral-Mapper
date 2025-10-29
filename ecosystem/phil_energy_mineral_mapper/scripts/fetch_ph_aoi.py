import pathlib

import geopandas as gpd
import pandas as pd

BASE_DIR = pathlib.Path(__file__).resolve().parent.parent


def save_gdf(gdf: gpd.GeoDataFrame, out_geojson: pathlib.Path) -> None:
    out_geojson.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(out_geojson, driver="GeoJSON")
    print(f"[AOI] Wrote {out_geojson.relative_to(BASE_DIR)}")


def fetch_country(country: str = "Philippines") -> gpd.GeoDataFrame:
    import osmnx as ox

    gdf = ox.geocode_to_gdf(country)
    gdf = gdf.to_crs(4326)
    return gdf[["geometry"]]


def fetch_provinces(names: list[str]) -> gpd.GeoDataFrame:
    import osmnx as ox

    out: list[gpd.GeoDataFrame] = []
    for name in names:
        try:
            province = ox.geocode_to_gdf(f"{name}, Philippines")
            province = province.to_crs(4326)
            province["name"] = name
            out.append(province[["name", "geometry"]])
        except Exception as exc:  # pragma: no cover - network dependent
            print(f"[WARN] Failed {name}: {exc}")
    if out:
        return pd.concat(out, ignore_index=True)
    return gpd.GeoDataFrame(columns=["name", "geometry"], geometry="geometry", crs=4326)


def main() -> None:
    out_dir = BASE_DIR / "data" / "aoi"

    country = fetch_country("Philippines")
    save_gdf(country, out_dir / "PH_country.geojson")

    provinces = [
        "Leyte",
        "Southern Leyte",
        "Negros Oriental",
        "Negros Occidental",
        "Mindoro Occidental",
        "Mindoro Oriental",
        "Palawan",
        "Albay",
        "Davao de Oro",
        "Agusan del Norte",
        "Surigao del Norte",
        "Zamboanga del Norte",
        "Benguet",
        "Zambales",
        "Sorsogon",
        "Samar",
        "South Cotabato",
        "Camarines Norte",
        "Camarines Sur",
    ]
    province_gdf = fetch_provinces(provinces)
    if not province_gdf.empty:
        save_gdf(province_gdf, out_dir / "PH_provinces.geojson")
        print("[AOI] Provinces fetched:", len(province_gdf))
    else:
        print("[AOI] No province AOIs fetched, skipping.")

    seeds = gpd.GeoDataFrame(
        {
            "name": [
                "Tongonan_Leyte",
                "Palinpinon_Negros",
                "MakBan_Laguna_Batangas",
                "Tiwi_Albay",
                "Mt_Apo_Davao",
                "Mt_Kitanglad_Bukidnon",
                "Mt_Marniog_N_Mindoro",
            ],
            "lon": [124.85, 122.02, 121.30, 123.68, 125.43, 124.88, 121.10],
            "lat": [11.12, 9.36, 14.16, 13.46, 6.99, 8.20, 13.22],
        }
    )
    seeds = gpd.GeoDataFrame(
        seeds,
        geometry=gpd.points_from_xy(seeds.lon, seeds.lat),
        crs=4326,
    )
    save_gdf(seeds, out_dir / "PH_geothermal_seeds.geojson")


if __name__ == "__main__":  # pragma: no cover - script entry point
    main()

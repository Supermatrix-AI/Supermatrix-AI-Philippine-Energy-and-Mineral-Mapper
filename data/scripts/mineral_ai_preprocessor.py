import ee, geemap, pandas as pd

ee.Initialize()

def extract_pixel_data(aoi, bands=['B4','B11']):
    s2 = ee.ImageCollection('COPERNICUS/S2_SR') \
        .filterBounds(aoi) \
        .filterDate('2023-01-01','2023-12-31') \
        .median()
    df = geemap.ee_to_pandas(s2.select(bands).sample(region=aoi, scale=30, numPixels=500))
    df.to_csv('data/sentinel_samples.csv', index=False)
    print("Exported data/sentinel_samples.csv")

# Example run: extract data from Mindanao
mindanao = ee.FeatureCollection('FAO/GAUL_SIMPLIFIED_500m/2015/level1') \
    .filter(ee.Filter.eq('ADM1_NAME', 'Northern Mindanao'))
extract_pixel_data(mindanao)

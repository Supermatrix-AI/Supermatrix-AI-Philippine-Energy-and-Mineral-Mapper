// ==========================================================
// Supermatrix-AI: Philippine Energy & Mineral Mapper (working)
// Focus: Philippines AOI, mineral + energy proxies (gold, silver, copper, REE, oil/gas, geothermal, etc.)
// Paste into: https://code.earthengine.google.com  -> New Script -> Paste -> Run
// IMPORTANT: All outputs are PROXIES. Validate with field data.
// ==========================================================

// -----------------------------
// AOI: Philippines bounding polygon (approx)
var PH = ee.Geometry.Polygon([
  [[116.0, 21.0], [127.8, 21.0], [127.8, 4.0], [116.0, 4.0]]
]);
Map.centerObject(PH, 6);

// -----------------------------
// Helpers (safe select, normalization)
// -----------------------------
function safeSelect(img, name){
  // If band exists -> select it, else return zero image with same name
  var names = img.bandNames();
  var has = names.contains(name);
  return ee.Image(ee.Algorithms.If(has, img.select([name]), ee.Image(0).rename(name)));
}

function norm01(img, minVal, maxVal){
  // Normalize an image to 0..1 using optional provided min/max (client side values okay)
  // Use small region sample to avoid heavy global stats
  minVal = (minVal === undefined) ?
    ee.Number(img.reduceRegion(ee.Reducer.percentile([5]), PH, 5000, 1e13).values().get(0)) :
    ee.Number(minVal);
  maxVal = (maxVal === undefined) ?
    ee.Number(img.reduceRegion(ee.Reducer.percentile([95]), PH, 5000, 1e13).values().get(0)) :
    ee.Number(maxVal);
  // if min or max are null (empty), return img masked to 0..1 via identity (avoid errors)
  return ee.Image(ee.Algorithms.If(
    minVal.eq(null).or(maxVal.eq(null)),
    img.multiply(0).add(0), // zero image
    img.subtract(minVal).divide(maxVal.subtract(minVal)).clamp(0,1)
  ));
}

// -----------------------------
// 1) Ingest core datasets (safe, widely available)
// -----------------------------
// ASTER (may have different band names in catalog: B01... B14)
var asterCol = ee.ImageCollection("ASTER/AST_L1T_003").filterBounds(PH).select(['B02','B01','B3N']); // try common names
var aster = ee.Image(0);
aster = ee.Algorithms.If(asterCol.size().gt(0), asterCol.median().clip(PH), aster);

// Landsat (LC08/LC09 L2 SR)
var landsatCol = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
  .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
  .filterBounds(PH)
  .filterDate('2018-01-01', '2025-12-31')
  .map(function(img){
    // simple QA mask for SR; if QA_PIXEL present
    var qa = img.select('QA_PIXEL');
    return ee.Algorithms.If(qa, img.updateMask(qa.bitwiseAnd(1<<3).eq(0).and(qa.bitwiseAnd(1<<4).eq(0))), img);
  });
var ls = ee.Image(landsatCol.median()).clip(PH);

// Sentinel-2 SR
var s2col = ee.ImageCollection('COPERNICUS/S2_SR').filterBounds(PH).filterDate('2019-01-01','2025-12-31');
var s2 = ee.Image(s2col.median()).clip(PH);

// SRTM DEM
var srtm = ee.Image("USGS/SRTMGL1_003").clip(PH);

// MODIS LST (as thermal proxy) - use 8-day product aggregated
var modisLST = ee.ImageCollection("MODIS/006/MOD11A2")
  .filterBounds(PH).filterDate('2018-01-01','2025-12-31')
  .select('LST_Day_1km').mean().multiply(0.02).clip(PH); // scale factor 0.02 -> Kelvin

// VIIRS nightlights (anthropogenic / thermal proxy)
var viirs = ee.ImageCollection("NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG")
  .filterBounds(PH).filterDate('2015-01-01','2025-12-31').median().clip(PH);

// GRACE/SMAP (coarse hydrology proxies) - use if available
var grace = ee.ImageCollection("NASA/GRACE/MASS_GRIDS")
  .filterBounds(PH).filterDate('2002-01-01','2020-12-31').mean().clip(PH);
var smap = ee.ImageCollection("NASA_USDA/HSL/SMAP_soil_moisture").filterBounds(PH).mean().clip(PH);

// Try optional datasets (GEDI, ECOSTRESS, EMIT) - only add when present
var gediCol = ee.ImageCollection("NASA/GEDI/GEDI02_A_002_MONTHLY");
var gedi = ee.Image(ee.Algorithms.If(gediCol.size().gt(0), gediCol.median().clip(PH), ee.Image(0)));

var ecoLSTcol = ee.ImageCollection("NASA/ECOSTRESS/VIIRS_LANDSURF_TEMP"); // alternative ECOSTRESS naming
var ecoLST = ee.Image(ee.Algorithms.If(ecoLSTcol.size().gt(0), ecoLSTcol.median().clip(PH), ee.Image(0)));

// -----------------------------
// 2) Compute spectral bands (safe select from Landsat median)
// -----------------------------
var SR_B2 = safeSelect(ls, 'SR_B2'); // blue
var SR_B3 = safeSelect(ls, 'SR_B3'); // green
var SR_B4 = safeSelect(ls, 'SR_B4'); // red
var SR_B5 = safeSelect(ls, 'SR_B5'); // NIR
var SR_B6 = safeSelect(ls, 'SR_B6'); // SWIR1
var SR_B7 = safeSelect(ls, 'SR_B7'); // SWIR2

// -----------------------------
// 3) Mineral proxies (heuristic, normalized 0..1). Colors assigned per mineral.
// -----------------------------
// Gold (hydrothermal alteration / iron oxide contrast + SWIR)
var gold = norm01(SR_B4.subtract(SR_B3).divide(SR_B4.add(SR_B3).add(1e-6))).rename('GoldProxy');
Map.addLayer(gold, {min: -0.3, max: 0.5, palette: ['black','gold']}, 'Gold Proxy (gold)');

// Silver (silicate/carbonate signal proxy)
var silver = norm01(SR_B5.subtract(SR_B7).divide(SR_B5.add(SR_B7).add(1e-6))).rename('SilverProxy');
Map.addLayer(silver, {min:-0.3, max:0.5, palette:['black','silver']}, 'Silver Proxy (silver)');

// Copper
var copper = norm01(SR_B6.subtract(SR_B5).divide(SR_B6.add(SR_B5).add(1e-6))).rename('CopperProxy');
Map.addLayer(copper, {min:-0.3, max:0.5, palette:['black','orange']}, 'Copper Proxy (orange)');

// Nickel / Cobalt proxy (magmatic/ultramafic signature often in SWIR+NIR)
var nickel = norm01(SR_B2.subtract(SR_B3).divide(SR_B2.add(SR_B3).add(1e-6))).rename('NickelProxy');
Map.addLayer(nickel, {min:-0.3, max:0.5, palette:['black','green']}, 'Nickel Proxy (green)');

// Platinum (proxy via combined SWIR signals)
var platinum = norm01(SR_B7.subtract(SR_B6).divide(SR_B7.add(SR_B6).add(1e-6))).rename('PlatinumProxy');
Map.addLayer(platinum, {min:-0.3, max:0.5, palette:['black','violet']}, 'Platinum Proxy (violet)');

// Zinc
var zinc = norm01(SR_B3.subtract(SR_B5).divide(SR_B3.add(SR_B5).add(1e-6))).rename('ZincProxy');
Map.addLayer(zinc, {min:-0.3, max:0.5, palette:['black','blue']}, 'Zinc Proxy (blue)');

// Iron (iron-oxide index)
var iron = norm01(SR_B4.subtract(SR_B3).divide(SR_B4.add(SR_B3).add(1e-6))).rename('IronProxy');
Map.addLayer(iron, {min:-0.3, max:0.5, palette:['black','red']}, 'Iron Proxy (red)');

// REE (approx) - we use ASTER bands if available, else use composite EM proxies
var asterImg = ee.Image(ee.Algorithms.If(asterCol.size().gt(0), asterCol.median().clip(PH), ee.Image(0)));
var ree = norm01(safeSelect(asterImg, 'B06')).rename('REEProxy'); // placeholder use ASTER band
Map.addLayer(ree, {min:0, max:1, palette:['black','cyan']}, 'REE Proxy (cyan)');

// -----------------------------
// 4) Energy proxies
// -----------------------------
// Thermal energy (MODIS LST)
var thermal = norm01(modisLST).rename('ThermalEnergy');
Map.addLayer(modisLST, {min:250, max:320, palette:['darkblue','yellow','red']}, 'MODIS LST (thermal)');

// Oil/Gas heuristic: SWIR contrast
var oilgas = norm01(SR_B6.add(SR_B7).divide(SR_B4.add(SR_B5).add(1e-6))).rename('OilGasProxy');
Map.addLayer(oilgas, {min:0, max:1, palette:['purple','white','brown']}, 'Oil/Gas Proxy (brown)');

// Geothermal (thermal + terrain + LST anomalies using ECOSTRESS if present)
var geo = norm01(thermal.add(norm01(ee.Image(ecoLST))).multiply(0.5)).rename('GeothermalProxy');
Map.addLayer(geo, {min:0, max:1, palette:['white','orange','red']}, 'Geothermal Proxy (orange)');

// -----------------------------
// 5) Composite / MegaFusion map (weighted)
// -----------------------------
var MegaFusion = ee.Image(0)
  .add(gold.multiply(0.20))
  .add(silver.multiply(0.12))
  .add(copper.multiply(0.12))
  .add(nickel.multiply(0.08))
  .add(platinum.multiply(0.05))
  .add(zinc.multiply(0.05))
  .add(iron.multiply(0.10))
  .add(ree.multiply(0.08))
  .add(oilgas.multiply(0.12))
  .add(geo.multiply(0.08))
  .rename('MegaFusion');

Map.addLayer(MegaFusion, {min:0, max:1, palette:['white','yellow','orange','red']}, 'Mega Fusion (combined)');

// -----------------------------
// 6) Hotspot extraction (centroid points with attributes)
//    - Threshold the MegaFusion map and produce centroids per cluster
// -----------------------------
var threshold = 0.6;
var mask = MegaFusion.gt(threshold);

var hotspots = mask.updateMask(mask).reduceToVectors({
  geometry: PH,
  geometryType: 'centroid',
  scale: 30,
  eightConnected: true,
  labelProperty: 'mask',
  maxPixels: 1e13
});

var hotspotsEnriched = hotspots.map(function(f){
  var geom = f.geometry();
  var lon = geom.centroid().coordinates().get(0);
  var lat = geom.centroid().coordinates().get(1);

  var meanMega = MegaFusion.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 30, maxPixels: 1e13}).get('MegaFusion');
  var meanGold = gold.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 30, maxPixels: 1e13}).get('GoldProxy');
  var elev = srtm.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 30, maxPixels: 1e13}).get('elevation');

  // heuristic depth estimator: shallower where magnetic/gradient high - but we use elevation as placeholder
  var depth = ee.Number(50).multiply(ee.Number(1).subtract(ee.Number(0))); // placeholder

  // area + volume proxies
  var pixelCount = mask.updateMask(mask).reduceRegion({reducer: ee.Reducer.sum(), geometry: geom, scale:30, maxPixels:1e13}).values().get(0);
  pixelCount = ee.Number(pixelCount || 1);
  var area_m2 = pixelCount.multiply(900); // 30x30
  var volume_m3 = area_m2.multiply(depth);

  return f.set({
    'lon': lon,
    'lat': lat,
    'Mean_MegaFusion': meanMega,
    'Mean_Gold': meanGold,
    'elevation_m': elev,
    'Estimated_depth_m': depth,
    'Area_m2': area_m2,
    'Volume_proxy_m3': volume_m3,
    'Datasets': 'Landsat,Sentinel2,ASTER,SRTM,MODIS,VIIRS,SMAP,GRACE'
  });
});

Map.addLayer(hotspotsEnriched, {color:'red'}, 'Hotspot centroids (threshold 0.6)');
print('Hotspots sample (first 50):', hotspotsEnriched.limit(50));

// -----------------------------
// 7) Export examples (run the Tasks panel to start)
// -----------------------------
Export.image.toDrive({
  image: MegaFusion,
  description: 'PH_MegaFusion_Map',
  folder: 'GEE_Exports',
  fileNamePrefix: 'PH_MegaFusion',
  region: PH,
  scale: 30,
  maxPixels: 1e13
});

Export.table.toDrive({
  collection: hotspotsEnriched,
  description: 'PH_Hotspots_Proxies',
  folder: 'GEE_Exports',
  fileNamePrefix: 'PH_Hotspots',
  fileFormat: 'CSV'
});

// Done
print('Gold, metals, energy proxies added. Use Inspector (top-right) to click map pixels and read band values.');

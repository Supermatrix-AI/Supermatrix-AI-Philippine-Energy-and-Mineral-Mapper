// ==========================================================
// Supermatrix-AI: Philippine Energy & Mineral Mapper (robust)
// Metals & Energy Proxy Mapping (Gold, Silver, Platinum, Copper, Nickel, Iron)
// Uses NASA + NASA partner data (safe fallbacks if unavailable).
// Paste into https://code.earthengine.google.com and Run
// IMPORTANT: All outputs are PROXIES. Validate with ground truth.
// ==========================================================

// -----------------------------
// Utility: check if an asset (image/collection) exists (client-side)
// -----------------------------
function assetExists(id) {
  try {
    var info = ee.data.getInfo(id);
    return info !== null;
  } catch (e) {
    // asset missing or access denied
    print('assetExists false for', id, e);
    return false;
  }
}

// -----------------------------
// Safe loader: returns an ee.Image (median) or a placeholder constant image
// -----------------------------
function loadCollectionMedianSafe(id, bounds, startDate, endDate, cloudPropName, cloudThreshold) {
  if (!assetExists(id)) {
    print('WARNING: asset not available or no access:', id);
    return ee.Image.constant(0).rename(id.replace(/[^A-Za-z0-9_]/g, '_'));
  }
  var col = ee.ImageCollection(id).filterBounds(bounds).filterDate(startDate, endDate);
  if (cloudPropName && cloudThreshold !== undefined) {
    try { col = col.filter(ee.Filter.lt(cloudPropName, cloudThreshold)); } catch(e){ /* ignore */ }
  }
  // If collection empty -> return constant image (safe)
  var size = col.size();
  var img = ee.Image(ee.Algorithms.If(size.gt(0), col.median().clip(bounds), ee.Image.constant(0).rename('empty_' + id.split('/').pop())));
  return ee.Image(img);
}

// -----------------------------
// AOI: Whole Philippines (change to smaller AOI while testing)
// -----------------------------
var ph = ee.FeatureCollection("FAO/GAUL/2015/level0")
            .filter(ee.Filter.eq('ADM0_NAME','Philippines'));
Map.centerObject(ph, 6);
Map.addLayer(ph.style({color:'000000', fillColor:'00000000'}), {}, 'Philippines AOI');

// -----------------------------
// Safe band select: if band missing return constant 0 image with that band name
// -----------------------------
function safeSelect(img, bandName, defaultVal) {
  img = ee.Image(img);
  var names = img.bandNames();
  var has = names.contains(bandName);
  var out = ee.Algorithms.If(has, img.select([bandName]), ee.Image.constant(defaultVal === undefined ? 0 : defaultVal).rename(bandName));
  return ee.Image(out);
}

// -----------------------------
// Basic normalizers (range-based / safe)
// -----------------------------
// For indices that naturally fall in [-1,1] we convert to [0,1].
function scaleIndexMinusOneToOneTo01(idxImage) {
  return idxImage.add(1).divide(2).clamp(0,1);
}
// Simple divisor-normalize with clamp
function normalizeBy(img, divisor) {
  return ee.Image(img).divide(divisor).clamp(0,1);
}

// -----------------------------
// 1) Load datasets (safe)
// -----------------------------
print('Loading datasets (may show missing-asset warnings)');

// ASTER (VNIR/SWIR)
var aster = loadCollectionMedianSafe("ASTER/AST_L1T_003", ph, '2000-01-01','2025-10-01');

// Landsat: try LC09 then fallback to LC08
var landsat9Id = "LANDSAT/LC09/C02/T1_L2";
var landsat8Id = "LANDSAT/LC08/C02/T1_L2";
var landsat = loadCollectionMedianSafe(landsat9Id, ph, '2015-01-01','2025-10-01','CLOUD_COVER',60);
// if landsat contains no sensible bands (placeholder) attempt fallback
var landsatCheck = landsat.bandNames();
print('Landsat median bands:', landsatCheck);
var landsat_is_placeholder = ee.List(landsat.bandNames()).size().eq(0);
landsat = ee.Image(ee.Algorithms.If(landsat_is_placeholder, loadCollectionMedianSafe(landsat8Id, ph, '2015-01-01','2025-10-01','CLOUD_COVER',60), landsat));

// Sentinel-2
var s2 = loadCollectionMedianSafe('COPERNICUS/S2_SR', ph, '2020-01-01','2025-10-01','CLOUDY_PIXEL_PERCENTAGE',40);

// EMIT (if available)
var emit = loadCollectionMedianSafe('NASA/EMIT/SurfaceMineralogy', ph, '2023-01-01','2025-10-01');

// VIIRS, MODIS, GRACE, SMAP
var viirs = loadCollectionMedianSafe("NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG", ph, '2012-01-01','2025-10-01');
var modis = loadCollectionMedianSafe('MODIS/006/MOD09GA', ph, '2000-01-01','2025-10-01');
var grace = loadCollectionMedianSafe("NASA/GRACE/MASS_GRIDS", ph, '2002-01-01','2025-10-01');
var smap = loadCollectionMedianSafe("NASA_USDA/HSL/SMAP_soil_moisture", ph, '2015-01-01','2025-10-01');

// Global geophysics (may be missing in some accounts)
var emag2 = assetExists("NOAA/NGDC/EMAG2_2") ? ee.Image("NOAA/NGDC/EMAG2_2").clip(ph) : ee.Image.constant(0).rename('EMAG2_placeholder');
if (assetExists("NOAA/NGDC/EMAG2_2")) Map.addLayer(emag2, {min:-200,max:200}, 'EMAG2');

// SRTM / ALOS
var srtm = ee.Image("USGS/SRTMGL1_003").clip(ph);
var alos = assetExists("JAXA/ALOS/AW3D30_V1_1") ? ee.Image("JAXA/ALOS/AW3D30_V1_1").clip(ph) : ee.Image.constant(0).rename('ALOS_placeholder');

// Sentinel-1 (SAR) median
var s1col = assetExists('COPERNICUS/S1_GRD') ? ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(ph).filterDate('2018-01-01','2025-10-01').select(['VV','VH']).median().clip(ph) : ee.Image.constant(0).rename('S1_placeholder');
if (assetExists('COPERNICUS/S1_GRD')) Map.addLayer(s1col, {min:-25, max:0}, 'Sentinel-1 median');

// GEDI & ECOSTRESS (may be missing)
var gedi = assetExists("NASA/GEDI/GEDI02_A_002_MONTHLY") ? ee.ImageCollection("NASA/GEDI/GEDI02_A_002_MONTHLY").filterBounds(ph).median().clip(ph) : ee.Image.constant(0).rename('GEDI_placeholder');
var ecoLST = assetExists("NASA/ECOSTRESS/LST/GERMLST") ? ee.ImageCollection('NASA/ECOSTRESS/LST/GERMLST').filterBounds(ph).median().clip(ph) : ee.Image.constant(0).rename('ECOSTRESS_LST_placeholder');
var ecoET = assetExists("NASA/ECOSTRESS/EVAPOTRANSPIRATION") ? ee.ImageCollection('NASA/ECOSTRESS/EVAPOTRANSPIRATION').filterBounds(ph).median().clip(ph) : ee.Image.constant(0).rename('ECOSTRESS_ET_placeholder');

Map.addLayer(aster, {bands:['B2','B1','B3N'], min:0, max:300}, 'ASTER (median)');
Map.addLayer(landsat, {bands:['SR_B4','SR_B3','SR_B2'], min:0, max:3000}, 'Landsat (median)');
Map.addLayer(s2, {bands:['B4','B3','B2'], min:0, max:3000}, 'Sentinel-2 (median)');
Map.addLayer(srtm, {min:0, max:1500}, 'SRTM DEM');

// -----------------------------
// 2) Build safe band images for indices
// -----------------------------
// Landsat SR bands names used: SR_B2..SR_B7
var L_red = safeSelect(landsat, 'SR_B4', 0);
var L_green = safeSelect(landsat, 'SR_B3', 0);
var L_blue = safeSelect(landsat, 'SR_B2', 0);
var L_nir = safeSelect(landsat, 'SR_B5', 0);
var L_sw1 = safeSelect(landsat, 'SR_B6', 0);
var L_sw2 = safeSelect(landsat, 'SR_B7', 0);

// ASTER bands
var AST_B1 = safeSelect(aster, 'B1', 0);
var AST_B2 = safeSelect(aster, 'B2', 0);
var AST_B3N = safeSelect(aster, 'B3N', 0);

// EMIT aggregated mean (if image has bands)
var emitMean = (function(){
  var bn = emit.bandNames();
  bn = ee.List(bn);
  var size = bn.size();
  return ee.Image( ee.Algorithms.If(size.gt(0),
    // average of bands (reduce by sum then divide)
    emit.reduce(ee.Reducer.mean()).rename('EMIT_mean'),
    ee.Image.constant(0).rename('EMIT_mean')
  ));
})();

// VIIRS normalizer
var viirsNorm = normalizeBy(viirs, 60);

// EMAG2 abs normalized (use 200 nT as a sensible scale)
var magAbs = normalizeBy(emag2.abs(), 200);

// GEDI rh100 normalized (0-100)
var gediRh100 = normalizeBy(safeSelect(gedi, 'rh100', 0), 100);

// ECOSTRESS LST normalized (rough: 250-330K)
var ecoN = ee.Image(ee.Algorithms.If(
  ecoLST.bandNames().size().gt(0),
  ecoLST.subtract(250).divide(80).clamp(0,1),
  ee.Image.constant(0)
)).rename('ECOSTRESS_norm');

// Slope normalized
var slope = ee.Terrain.slope(srtm).divide(45).clamp(0,1).rename('slope_norm');

// -----------------------------
// 3) Compute spectral indices safely (map to 0..1)
// -----------------------------
function safeIndexRatio(a,b) {
  // compute (a-b)/(a+b) safely
  var num = a.subtract(b);
  var den = a.add(b).add(1e-6);
  var idx = num.divide(den);
  return scaleIndexMinusOneToOneTo01(idx);
}

// IOI (iron-oxide index) using Red & Green
var IOI = safeIndexRatio(L_red, L_green).rename('IOI');
Map.addLayer(IOI, {min:0, max:1}, 'IOI (iron oxide proxy)');

// Clay index (SWIR)
var Clay = safeIndexRatio(L_sw1, L_sw2).rename('Clay');
Map.addLayer(Clay, {min:0, max:1}, 'Clay (SWIR proxy)');

// Carbonate-like proxy
var Carb = safeIndexRatio(L_sw2, L_nir).rename('Carbonate');
Map.addLayer(Carb, {min:0, max:1}, 'Carbonate proxy');

// ASTER iron proxy (B2-B1)/(B2+B1)
var AST_Iron_raw = AST_B2.subtract(AST_B1).divide(AST_B2.add(AST_B1).add(1e-6));
var AST_Iron = scaleIndexMinusOneToOneTo01(AST_Iron_raw).rename('AST_Iron');
Map.addLayer(AST_Iron, {min:0, max:1}, 'ASTER Iron proxy');

// -----------------------------
// 4) Metal proxy compositions (heuristic weights)
// -----------------------------
// We use linear weighted combos of the normalized proxies above.
// These are starting heuristics and must be validated with ground truth.
var GoldProxy = IOI.multiply(0.25)
  .add(Clay.multiply(0.20))
  .add(AST_Iron.multiply(0.10))
  .add(magAbs.multiply(0.20))
  .add(slope.multiply(0.05))
  .add(gediRh100.multiply(0.10))
  .add(ecoN.multiply(0.10))
  .rename('GoldProxy').clamp(0,1);

var SilverProxy = IOI.multiply(0.20)
  .add(Carb.multiply(0.20))
  .add(AST_Iron.multiply(0.15))
  .add(magAbs.multiply(0.15))
  .add(slope.multiply(0.10))
  .add(gediRh100.multiply(0.10))
  .add(ecoN.multiply(0.10))
  .rename('SilverProxy').clamp(0,1);

var PlatinumProxy = IOI.multiply(0.15)
  .add(Clay.multiply(0.10))
  .add(AST_Iron.multiply(0.20))
  .add(magAbs.multiply(0.25))
  .add(slope.multiply(0.10))
  .add(gediRh100.multiply(0.10))
  .add(ecoN.multiply(0.10))
  .rename('PlatinumProxy').clamp(0,1);

var CopperProxy = IOI.multiply(0.20)
  .add(Clay.multiply(0.15))
  .add(AST_Iron.multiply(0.20))
  .add(magAbs.multiply(0.20))
  .add(slope.multiply(0.10))
  .add(gediRh100.multiply(0.10))
  .add(ecoN.multiply(0.05))
  .rename('CopperProxy').clamp(0,1);

var NickelProxy = IOI.multiply(0.15)
  .add(Clay.multiply(0.20))
  .add(AST_Iron.multiply(0.20))
  .add(magAbs.multiply(0.20))
  .add(slope.multiply(0.10))
  .add(gediRh100.multiply(0.10))
  .rename('NickelProxy').clamp(0,1);

var IronProxy = IOI.multiply(0.10)
  .add(Clay.multiply(0.10))
  .add(AST_Iron.multiply(0.30))
  .add(magAbs.multiply(0.30))
  .add(slope.multiply(0.05))
  .add(gediRh100.multiply(0.10))
  .rename('IronProxy').clamp(0,1);

// Display proxies
Map.addLayer(GoldProxy, {min:0,max:1,palette:['white','yellow','orange','red']}, 'Gold Potential');
Map.addLayer(SilverProxy, {min:0,max:1,palette:['white','silver','gray','blue']}, 'Silver Potential');
Map.addLayer(PlatinumProxy, {min:0,max:1,palette:['white','green','blue','purple']}, 'Platinum Potential');
Map.addLayer(CopperProxy, {min:0,max:1,palette:['white','orange','red']}, 'Copper Potential');
Map.addLayer(NickelProxy, {min:0,max:1,palette:['white','brown','red','black']}, 'Nickel Potential');
Map.addLayer(IronProxy, {min:0,max:1,palette:['white','yellow','brown','red']}, 'Iron Potential');

// -----------------------------
// 5) Hotspot extraction per-metal (safe & limited)
//    -> For each metal: mask = proxy > threshold, reduceToVectors (polygons)
//    -> compute centroid lon/lat, area (m2), estimated depth (heuristic), volume proxy
// -----------------------------
function extractHotspotsFromProxy(proxyImg, proxyName, threshold, maxFeatures) {
  threshold = threshold || 0.7; // default threshold
  maxFeatures = maxFeatures || 200; // safety limit
  var mask = proxyImg.gt(threshold).selfMask();
  // reduce to polygons for entire Philippines AOI
  var vectors = mask.reduceToVectors({
    geometry: ph.geometry(),
    scale: 30,
    geometryType: 'polygon',
    eightConnected: true,
    labelProperty: 'mask',
    maxPixels: 1e13
  });
  // if vectors empty return empty collection
  vectors = ee.FeatureCollection(ee.Algorithms.If(vectors.size().gt(0), vectors, ee.FeatureCollection([])));

  // Enrich features and compute attributes
  var enriched = vectors.map(function(f){
    var geom = f.geometry();
    var meanVal = ee.Number(proxyImg.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: geom,
      scale: 30,
      maxPixels: 1e9
    }).get(proxyName));
    meanVal = ee.Number(ee.Algorithms.If(meanVal, meanVal, 0));

    // mean magAbs and slope inside region
    var meanMag = ee.Number(magAbs.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 100, maxPixels:1e9}).get('EMAG2_placeholder'));
    // magAbs band name depends: if original EMAG2 used it's 'emag2' maybe - handle both:
    meanMag = ee.Number(ee.Algorithms.If(meanMag, meanMag, ee.Number(magAbs.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 100, maxPixels:1e9}).values().get(0)).divide(1) || 0));

    var meanSlope = ee.Number(slope.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 100, maxPixels:1e9}).get('slope_norm'));
    meanSlope = ee.Number(ee.Algorithms.If(meanSlope, meanSlope, 0));

    // Depth estimator (heuristic): base*(1 - meanMag)*(1 + slope/10)
    var base = 60.0;
    var depth = ee.Number(base).multiply(ee.Number(1).subtract(meanMag)).multiply(ee.Number(1).add(meanSlope.divide(10)));
    depth = depth.max(5).min(2000);

    // area (m2)
    var area_m2 = ee.Number(geom.area());
    // volume proxy = area * depth * meanVal (probabilistic)
    var volume_m3 = area_m2.multiply(depth).multiply(meanVal);

    // centroid coords
    var centroid = geom.centroid(1).coordinates();
    var lon = centroid.get(0);
    var lat = centroid.get(1);

    return f.set({
      'metal': proxyName,
      'meanVal': meanVal,
      'threshold': threshold,
      'area_m2': area_m2,
      'depth_m': depth,
      'volume_proxy_m3': volume_m3,
      'lon': lon,
      'lat': lat
    });
  });

  // sort by meanVal descending and limit to maxFeatures
  var top = enriched.sort('meanVal', false).limit(maxFeatures);
  return top;
}

// Configure metals to extract
var metals = [
  {img: GoldProxy, name: 'GoldProxy', threshold: 0.7},
  {img: SilverProxy, name: 'SilverProxy', threshold: 0.7},
  {img: PlatinumProxy, name: 'PlatinumProxy', threshold: 0.7},
  {img: CopperProxy, name: 'CopperProxy', threshold: 0.7},
  {img: NickelProxy, name: 'NickelProxy', threshold: 0.7},
  {img: IronProxy, name: 'IronProxy', threshold: 0.7}
];

// Build a combined Hotspots FeatureCollection (top N per metal)
var allHotspotsList = metals.map(function(m) {
  return extractHotspotsFromProxy(m.img, m.name, m.threshold, 200);
});
// Flatten list of collections into one FeatureCollection
var allHotspots = ee.FeatureCollection(ee.List(allHotspotsList).iterate(function(fc, acc){
  acc = ee.FeatureCollection(acc);
  return acc.merge(ee.FeatureCollection(fc));
}, ee.FeatureCollection([])));

Map.addLayer(allHotspots.style({color:'red'}), {}, 'All Metal Hotspots (sample top clusters)');
print('Hotspots sample (first 50):', allHotspots.limit(50));

// -----------------------------
// 6) Exports
//    - For safety: export hotspot vectors (limited) and raster (coarsened if needed).
//    - You must run these Export tasks from the Tasks tab in the Code Editor (click Run there).
// -----------------------------

// Export hotspots (all metals) — CSV to Drive
Export.table.toDrive({
  collection: allHotspots,
  description: 'PH_Metals_Hotspots_top',
  folder: 'GEE_Exports',
  fileNamePrefix: 'Philippines_Metal_Hotspots_top',
  fileFormat: 'CSV'
});

// For each metal export a moderate-resolution raster (here 100m) to reduce size.
// Increase scale to 30m only if you understand export will be large.
metals.forEach(function(m){
  Export.image.toDrive({
    image: m.img,
    description: m.name + '_Potential_PH_100m',
    folder: 'GEE_Exports',
    fileNamePrefix: m.name + '_Potential_PH_100m',
    region: ph.geometry().bounds(),
    scale: 100,
    maxPixels: 1e13,
    crs: 'EPSG:4326'
  });
});

// -----------------------------
// 7) Guidance: Inspecting & using outputs
// -----------------------------
print('--- SUMMARY & NEXT STEPS ---');
print('1) The map shows proxy layers for Gold, Silver, Platinum, Copper, Nickel, Iron (0..1 scale).');
print('2) Use the Inspector tool (top-right of Map window) to click on any point to read layer pixel values.');
print('3) Hotspots table (exported) contains centroid lon/lat, area_m2, depth_m (heuristic), and volume_proxy_m3.');
print('4) To get exact coordinates: Inspect a hotspot, or download the CSV and open in QGIS/Excel.');
print('5) Validate: PROXIES -> field sampling (ICP-MS) and ground geophysics are required before any resource claims.');
print('Notes: Some datasets (GEDI / ECOSTRESS / EMAG2 / EMIT) may be unavailable to your account; the script prints missing-asset warnings and uses safe placeholders in that case.');

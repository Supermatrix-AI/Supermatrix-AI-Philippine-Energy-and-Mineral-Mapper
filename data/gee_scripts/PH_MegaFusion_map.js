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
    return ee.Image.constant(0)
      .rename(id.replace(/[^A-Za-z0-9_]/g, '_'))
      .set('source_available', 0);
  }
  var col = ee.ImageCollection(id).filterBounds(bounds).filterDate(startDate, endDate);
  if (cloudPropName && cloudThreshold !== undefined) {
    try { col = col.filter(ee.Filter.lt(cloudPropName, cloudThreshold)); } catch(e){ /* ignore */ }
  }
  // If collection empty -> return constant image (safe)
  var size = col.size();
  var imageWithData = col.median().clip(bounds).set('source_available', 1);
  var placeholderImg = ee.Image.constant(0)
    .rename('empty_' + id.split('/').pop())
    .set('source_available', 0);
  var img = ee.Image(ee.Algorithms.If(size.gt(0), imageWithData, placeholderImg));
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

function safeSelectAny(img, bandNames, defaultVal) {
  img = ee.Image(img);
  var names = ee.List(bandNames);
  var imgBands = img.bandNames();
  var matches = names.filter(function(name){
    name = ee.String(name);
    return imgBands.contains(name);
  });
  var hasMatch = ee.Number(matches.size()).gt(0);
  var firstMatch = ee.String(matches.get(0));
  var fallbackName = ee.String(names.get(0));
  var out = ee.Algorithms.If(hasMatch,
    img.select([firstMatch]),
    ee.Image.constant(defaultVal === undefined ? 0 : defaultVal).rename(fallbackName)
  );
  return ee.Image(out).rename(ee.String(ee.Algorithms.If(hasMatch, firstMatch, fallbackName)));
}

// Availability helper: returns constant image flag (1=source present, 0=placeholder)
function availabilityFlag(image, fallbackValue) {
  var defaultVal = fallbackValue === undefined ? 1 : fallbackValue;
  var val = ee.Number(ee.Algorithms.If(image.get('source_available'), image.get('source_available'), defaultVal));
  return ee.Image.constant(val);
}

function buildWeightedProxy(name, components) {
  var proxy = ee.Image.constant(0);
  components.forEach(function(c){
    proxy = proxy.add(ee.Image(c.image).multiply(c.weight));
  });
  return proxy.clamp(0,1).rename(name);
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
// if landsat is placeholder attempt fallback to Landsat-8
var landsatAvailability = ee.Number(ee.Algorithms.If(landsat.get('source_available'), landsat.get('source_available'), 0));
landsat = ee.Image(ee.Algorithms.If(landsatAvailability.eq(1), landsat,
  loadCollectionMedianSafe(landsat8Id, ph, '2015-01-01','2025-10-01','CLOUD_COVER',60)));
print('Landsat median bands:', landsat.bandNames());

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
var emag2Available = assetExists("NOAA/NGDC/EMAG2_2");
var emag2 = emag2Available ? ee.Image("NOAA/NGDC/EMAG2_2").clip(ph).set('source_available', 1)
                           : ee.Image.constant(0).rename('EMAG2_placeholder').set('source_available', 0);
if (emag2Available) Map.addLayer(emag2, {min:-200,max:200}, 'EMAG2');

// SRTM / ALOS
var srtm = ee.Image("USGS/SRTMGL1_003").clip(ph).set('source_available', 1);
var alosAvailable = assetExists("JAXA/ALOS/AW3D30_V1_1");
var alos = alosAvailable ? ee.Image("JAXA/ALOS/AW3D30_V1_1").clip(ph).set('source_available', 1)
                         : ee.Image.constant(0).rename('ALOS_placeholder').set('source_available', 0);

// Sentinel-1 (SAR) median
var s1Available = assetExists('COPERNICUS/S1_GRD');
var s1col = s1Available ? ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(ph).filterDate('2018-01-01','2025-10-01').select(['VV','VH']).median().clip(ph).set('source_available', 1)
                        : ee.Image.constant(0).rename('S1_placeholder').set('source_available', 0);
if (s1Available) Map.addLayer(s1col, {min:-25, max:0}, 'Sentinel-1 median');

// GEDI & ECOSTRESS (may be missing)
var gediAvailable = assetExists("NASA/GEDI/GEDI02_A_002_MONTHLY");
var gedi = gediAvailable ? ee.ImageCollection("NASA/GEDI/GEDI02_A_002_MONTHLY").filterBounds(ph).median().clip(ph).set('source_available', 1)
                         : ee.Image.constant(0).rename('GEDI_placeholder').set('source_available', 0);
var ecoLSTAvailable = assetExists("NASA/ECOSTRESS/LST/GERMLST");
var ecoLST = ecoLSTAvailable ? ee.ImageCollection('NASA/ECOSTRESS/LST/GERMLST').filterBounds(ph).median().clip(ph).set('source_available', 1)
                             : ee.Image.constant(0).rename('ECOSTRESS_LST_placeholder').set('source_available', 0);
var ecoETAvailable = assetExists("NASA/ECOSTRESS/EVAPOTRANSPIRATION");
var ecoET = ecoETAvailable ? ee.ImageCollection('NASA/ECOSTRESS/EVAPOTRANSPIRATION').filterBounds(ph).median().clip(ph).set('source_available', 1)
                           : ee.Image.constant(0).rename('ECOSTRESS_ET_placeholder').set('source_available', 0);

Map.addLayer(aster, {bands:['B2','B1','B3N'], min:0, max:300}, 'ASTER (median)');
Map.addLayer(landsat, {bands:['SR_B4','SR_B3','SR_B2'], min:0, max:3000}, 'Landsat (median)');
Map.addLayer(s2, {bands:['B4','B3','B2'], min:0, max:3000}, 'Sentinel-2 (median)');
Map.addLayer(srtm, {min:0, max:1500}, 'SRTM DEM');

var availabilitySum = availabilityFlag(aster, 0)
  .add(availabilityFlag(landsat, 0))
  .add(availabilityFlag(s2, 0))
  .add(availabilityFlag(emit, 0))
  .add(availabilityFlag(viirs, 0))
  .add(availabilityFlag(modis, 0))
  .add(availabilityFlag(grace, 0))
  .add(availabilityFlag(smap, 0))
  .add(availabilityFlag(emag2, 0))
  .add(availabilityFlag(srtm, 0))
  .add(availabilityFlag(alos, 0))
  .add(availabilityFlag(s1col, 0))
  .add(availabilityFlag(gedi, 0))
  .add(availabilityFlag(ecoLST, 0))
  .add(availabilityFlag(ecoET, 0));
var datasetCount = 15;
var dataAvailability = availabilitySum.divide(datasetCount).rename('data_availability');
Map.addLayer(dataAvailability, {min:0, max:1, palette:['7f0000','ffae42','3cb371']}, 'Sensor availability confidence');

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

var ecoETBand = safeSelectAny(ecoET, ['ETinst','et','LEinst','LE'], 0);
var ecoETNorm = normalizeBy(ecoETBand, 10).rename('ECOSTRESS_ET_norm');

var graceBand = safeSelectAny(grace, ['lwe_thickness_csr','lwe_thickness_gfz','lwe_thickness_jpl'], 0);
var graceWater = normalizeBy(graceBand.abs(), 50).rename('GRACE_water');

var smapBand = safeSelectAny(smap, ['susm','ssm','surface_soil_moisture'], 0);
var smapMoisture = normalizeBy(smapBand, 0.6).rename('SMAP_moisture');

var s1vv = safeSelectAny(s1col, ['VV','VV_mean','VV_median'], -20);
var s1vh = safeSelectAny(s1col, ['VH','VH_mean','VH_median'], -25);
var sarRatio = s1vv.subtract(s1vh).divide(30).add(0.5).clamp(0,1).rename('SAR_ratio');

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
var gentleSlope = ee.Image(1).subtract(slope).clamp(0,1).rename('gentle_slope');

var GoldProxy = buildWeightedProxy('GoldProxy', [
  {image: IOI, weight: 0.18},
  {image: Clay, weight: 0.12},
  {image: AST_Iron, weight: 0.12},
  {image: magAbs, weight: 0.18},
  {image: slope, weight: 0.08},
  {image: gediRh100, weight: 0.08},
  {image: ecoN, weight: 0.07},
  {image: sarRatio, weight: 0.07},
  {image: emitMean, weight: 0.08}
]);

var SilverProxy = buildWeightedProxy('SilverProxy', [
  {image: IOI, weight: 0.18},
  {image: Carb, weight: 0.18},
  {image: AST_Iron, weight: 0.15},
  {image: magAbs, weight: 0.15},
  {image: slope, weight: 0.08},
  {image: gediRh100, weight: 0.10},
  {image: ecoN, weight: 0.08},
  {image: dataAvailability, weight: 0.08}
]);

var PlatinumProxy = buildWeightedProxy('PlatinumProxy', [
  {image: IOI, weight: 0.14},
  {image: Clay, weight: 0.10},
  {image: AST_Iron, weight: 0.20},
  {image: magAbs, weight: 0.20},
  {image: sarRatio, weight: 0.10},
  {image: gediRh100, weight: 0.08},
  {image: ecoN, weight: 0.08},
  {image: emitMean, weight: 0.10}
]);

var CopperProxy = buildWeightedProxy('CopperProxy', [
  {image: IOI, weight: 0.18},
  {image: Clay, weight: 0.15},
  {image: AST_Iron, weight: 0.20},
  {image: magAbs, weight: 0.18},
  {image: slope, weight: 0.08},
  {image: gediRh100, weight: 0.08},
  {image: ecoN, weight: 0.07},
  {image: sarRatio, weight: 0.06}
]);

var NickelProxy = buildWeightedProxy('NickelProxy', [
  {image: IOI, weight: 0.15},
  {image: Clay, weight: 0.20},
  {image: AST_Iron, weight: 0.18},
  {image: magAbs, weight: 0.20},
  {image: slope, weight: 0.08},
  {image: gediRh100, weight: 0.10},
  {image: dataAvailability, weight: 0.09}
]);

var IronProxy = buildWeightedProxy('IronProxy', [
  {image: IOI, weight: 0.12},
  {image: Clay, weight: 0.10},
  {image: AST_Iron, weight: 0.28},
  {image: magAbs, weight: 0.28},
  {image: slope, weight: 0.08},
  {image: gediRh100, weight: 0.07},
  {image: sarRatio, weight: 0.07}
]);

var RareEarthProxy = buildWeightedProxy('RareEarthProxy', [
  {image: Clay, weight: 0.22},
  {image: Carb, weight: 0.15},
  {image: AST_Iron, weight: 0.18},
  {image: emitMean, weight: 0.20},
  {image: gediRh100, weight: 0.08},
  {image: dataAvailability, weight: 0.17}
]);

var OilGasProxy = buildWeightedProxy('OilGasProxy', [
  {image: viirsNorm, weight: 0.20},
  {image: ecoN, weight: 0.15},
  {image: ecoETNorm, weight: 0.15},
  {image: graceWater, weight: 0.18},
  {image: smapMoisture, weight: 0.15},
  {image: gentleSlope, weight: 0.10},
  {image: dataAvailability, weight: 0.07}
]);

var GeothermalProxy = buildWeightedProxy('GeothermalProxy', [
  {image: ecoN, weight: 0.25},
  {image: ecoETNorm, weight: 0.15},
  {image: sarRatio, weight: 0.15},
  {image: magAbs, weight: 0.10},
  {image: slope, weight: 0.10},
  {image: gediRh100, weight: 0.10},
  {image: dataAvailability, weight: 0.15}
]);

var MegaFusion = buildWeightedProxy('MegaFusion', [
  {image: GoldProxy, weight: 0.12},
  {image: SilverProxy, weight: 0.10},
  {image: PlatinumProxy, weight: 0.10},
  {image: CopperProxy, weight: 0.12},
  {image: NickelProxy, weight: 0.10},
  {image: IronProxy, weight: 0.10},
  {image: RareEarthProxy, weight: 0.12},
  {image: OilGasProxy, weight: 0.12},
  {image: GeothermalProxy, weight: 0.12}
]);

var fusionStd = ee.Image.cat([
  GoldProxy, SilverProxy, PlatinumProxy, CopperProxy, NickelProxy,
  IronProxy, RareEarthProxy, OilGasProxy, GeothermalProxy
]).reduce(ee.Reducer.stdDev());
var consensusScore = ee.Image(1).subtract(fusionStd).clamp(0,1).rename('consensus_score');
var fusionConfidence = consensusScore.multiply(dataAvailability).rename('fusion_confidence');

// Display proxies
Map.addLayer(GoldProxy, {min:0,max:1,palette:['white','yellow','orange','red']}, 'Gold Potential');
Map.addLayer(SilverProxy, {min:0,max:1,palette:['white','#d9d9d9','#7f7f7f','#1f78b4']}, 'Silver Potential');
Map.addLayer(PlatinumProxy, {min:0,max:1,palette:['white','#8dd3c7','#80b1d3','#4d004b']}, 'Platinum Potential');
Map.addLayer(CopperProxy, {min:0,max:1,palette:['white','#fdae61','#d7191c']}, 'Copper Potential');
Map.addLayer(NickelProxy, {min:0,max:1,palette:['white','#a6611a','#7f3b08','#252525']}, 'Nickel Potential');
Map.addLayer(IronProxy, {min:0,max:1,palette:['white','#fee08b','#d73027']}, 'Iron Potential');
Map.addLayer(RareEarthProxy, {min:0,max:1,palette:['white','#c994c7','#dd3497','#7a0177']}, 'Rare Earth Potential');
Map.addLayer(OilGasProxy, {min:0,max:1,palette:['white','#fdb863','#b35806','#543005']}, 'Oil & Gas Potential');
Map.addLayer(GeothermalProxy, {min:0,max:1,palette:['white','#ffffbf','#1a9850','#006837']}, 'Geothermal Potential');
Map.addLayer(MegaFusion, {min:0,max:1,palette:['#f7fcf5','#c7e9c0','#7fcdbb','#1d91c0','#0c2c84']}, 'MegaFusion (all resources)');
Map.addLayer(fusionConfidence, {min:0,max:1,palette:['#7f0000','#b30000','#fdae61','#a6d96a','#1a9850']}, 'Fusion confidence (consensus x data)');

// -----------------------------
// 5) Hotspot extraction per-metal (safe & limited)
//    -> For each metal: mask = proxy > threshold, reduceToVectors (polygons)
//    -> compute centroid lon/lat, area (m2), estimated depth (heuristic), volume proxy
// -----------------------------
function extractHotspotsFromProxy(proxyImg, proxyName, threshold, maxFeatures, category) {
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
    var magDict = magAbs.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 100, maxPixels:1e9});
    var meanMag = ee.Number(ee.Algorithms.If(magDict.values().size().gt(0), magDict.values().get(0), 0));

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
      'target': proxyName,
      'category': category || 'metal',
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

// Configure resources to extract
var targets = [
  {img: GoldProxy, band: 'GoldProxy', label: 'Gold', threshold: 0.7, category: 'metal'},
  {img: SilverProxy, band: 'SilverProxy', label: 'Silver', threshold: 0.7, category: 'metal'},
  {img: PlatinumProxy, band: 'PlatinumProxy', label: 'Platinum', threshold: 0.7, category: 'metal'},
  {img: CopperProxy, band: 'CopperProxy', label: 'Copper', threshold: 0.7, category: 'metal'},
  {img: NickelProxy, band: 'NickelProxy', label: 'Nickel', threshold: 0.7, category: 'metal'},
  {img: IronProxy, band: 'IronProxy', label: 'Iron', threshold: 0.7, category: 'metal'},
  {img: RareEarthProxy, band: 'RareEarthProxy', label: 'Rare Earth Elements', threshold: 0.65, category: 'critical_mineral'},
  {img: OilGasProxy, band: 'OilGasProxy', label: 'Oil & Gas', threshold: 0.6, category: 'energy'},
  {img: GeothermalProxy, band: 'GeothermalProxy', label: 'Geothermal', threshold: 0.6, category: 'energy'},
  {img: MegaFusion, band: 'MegaFusion', label: 'MegaFusion Composite', threshold: 0.65, category: 'fusion'}
];

// Build a combined Hotspots FeatureCollection (top N per target)
var allHotspotsList = targets.map(function(m) {
  var fc = extractHotspotsFromProxy(m.img, m.band, m.threshold, m.maxFeatures || 200, m.category);
  return ee.FeatureCollection(fc).map(function(f){
    return f.set({
      'label': m.label,
      'category': m.category,
      'threshold': m.threshold
    });
  });
});
// Flatten list of collections into one FeatureCollection
var allHotspots = ee.FeatureCollection(ee.List(allHotspotsList).iterate(function(fc, acc){
  acc = ee.FeatureCollection(acc);
  return acc.merge(ee.FeatureCollection(fc));
}, ee.FeatureCollection([])));

Map.addLayer(allHotspots.style({color:'red'}), {}, 'All resource hotspots (sample)');
print('Hotspots sample (first 50):', allHotspots.limit(50));

// -----------------------------
// 6) Exports
//    - For safety: export hotspot vectors (limited) and raster (coarsened if needed).
//    - You must run these Export tasks from the Tasks tab in the Code Editor (click Run there).
// -----------------------------

// Export hotspots (all resources) — CSV to Drive
Export.table.toDrive({
  collection: allHotspots,
  description: 'PH_Supermatrix_hotspots',
  folder: 'GEE_Exports',
  fileNamePrefix: 'Philippines_Supermatrix_hotspots',
  fileFormat: 'CSV',
  selectors: ['target','label','category','meanVal','threshold','area_m2','depth_m','volume_proxy_m3','lon','lat']
});

// For each target export a moderate-resolution raster (here 100m) to reduce size.
// Increase scale to 30m only if you understand export will be large.
targets.forEach(function(m){
  Export.image.toDrive({
    image: m.img,
    description: m.band + '_Potential_PH_100m',
    folder: 'GEE_Exports',
    fileNamePrefix: m.band + '_Potential_PH_100m',
    region: ph.geometry().bounds(),
    scale: 100,
    maxPixels: 1e13,
    crs: 'EPSG:4326'
  });
});

Export.image.toDrive({
  image: fusionConfidence,
  description: 'FusionConfidence_PH_100m',
  folder: 'GEE_Exports',
  fileNamePrefix: 'FusionConfidence_PH_100m',
  region: ph.geometry().bounds(),
  scale: 100,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

Export.image.toDrive({
  image: dataAvailability,
  description: 'SensorAvailability_PH_1km',
  folder: 'GEE_Exports',
  fileNamePrefix: 'SensorAvailability_PH_1km',
  region: ph.geometry().bounds(),
  scale: 1000,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// -----------------------------
// 7) Guidance: Inspecting & using outputs
// -----------------------------
print('--- SUMMARY & NEXT STEPS ---');
print('1) Layers cover metallic targets, rare earths, oil & gas, geothermal, a MegaFusion composite, and confidence rasters (consensus + data availability).');
print('2) Use the Inspector (Map tab) to read per-pixel proxy strengths (0..1) together with the availability/confidence layers.');
print('3) Hotspot CSV exports centroid lon/lat, area_m2, heuristic depth & volume proxies, plus category metadata for downstream triage.');
print('4) FusionConfidence + SensorAvailability rasters support responsible deployment by highlighting where the stack is data-poor.');
print('5) Validate: these are PROXIES only. Require field sampling, regulatory vetting, and consultation with local stakeholders before any extraction decisions.');
print('Notes: Some datasets (e.g., GEDI, ECOSTRESS, EMIT, EMAG2) may be unavailable to your account; missing assets fallback to placeholders and reduce the confidence score.');

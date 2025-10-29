from fastapi import FastAPI
from pathlib import Path

app = FastAPI(title="Supermatrix-AI PH Energy & Mineral Mapper API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "stack": "PHEMM"}


@app.get("/layers")
def layers() -> dict[str, list[str]]:
    base = Path("vault")
    return {"files": [str(path) for path in base.rglob("*") if path.is_file()]}
# Run: uvicorn services.api.main:app --reload --port 8099
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from typing import Optional
import json

from rio_tiler.io import Reader
from rio_tiler.errors import TileOutsideBounds
from morecantile import TileMatrixSet

APP_ROOT = Path(__file__).resolve().parents[2]
VAULT = APP_ROOT / "vault"
WEB = APP_ROOT / "web" / "app"
TMS = TileMatrixSet.web_mercator()

app = FastAPI(
    title="Supermatrix-AI PH Energy & Mineral Mapper API", version="1.1"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(WEB)), name="static")


@app.get("/health")
def health():
    return {"status": "ok", "stack": "PHEMM", "vault": str(VAULT)}


@app.get("/", response_class=HTMLResponse)
def home():
    index = WEB / "index.html"
    if not index.exists():
        return HTMLResponse("<h3>PHEMM Web app missing. Rebuild.</h3>", status_code=200)
    return HTMLResponse(index.read_text("utf-8"))


@app.get("/layers")
def layers():
    files = [str(p.relative_to(APP_ROOT)) for p in VAULT.rglob("*") if p.is_file()]
    return {"files": files}


@app.get("/geojson")
def geojson_list():
    geojson_files = [
        str(p.relative_to(APP_ROOT)) for p in VAULT.rglob("*.geojson")
    ]
    return {"geojson": geojson_files}


@app.get("/geojson/get")
def geojson_get(path: str):
    fp = APP_ROOT / path
    if not fp.exists() or fp.suffix.lower() != ".geojson":
        raise HTTPException(404, "GeoJSON not found")
    return JSONResponse(
        json.loads(fp.read_text("utf-8")), media_type="application/geo+json"
    )


def _raster_path(src: Optional[str]) -> Path:
    if src:
        p = APP_ROOT / src
        if p.exists():
            return p
        raise HTTPException(404, f"Raster not found: {src}")
    tifs = list(VAULT.rglob("*.tif"))
    if not tifs:
        raise HTTPException(404, "No GeoTIFF found in vault/")
    return tifs[0]


@app.get("/preview")
def preview(src: Optional[str] = Query(None), max_size: int = 1024):
    fp = _raster_path(src)
    with Reader(fp) as reader:
        img = reader.preview(max_size=max_size)
        content = img.render(img_format="PNG")
        return Response(content, media_type="image/png")


@app.get("/tiles/{z}/{x}/{y}")
def tiles(z: int, x: int, y: int, src: Optional[str] = Query(None)):
    fp = _raster_path(src)
    try:
        with Reader(fp) as reader:
            img = reader.tile(x, y, z, tilesize=256)
            content = img.render(img_format="PNG")
            headers = {
                "Cache-Control": "public, max-age=3600",
                "Access-Control-Allow-Origin": "*",
            }
            return Response(content, media_type="image/png", headers=headers)
    except TileOutsideBounds as exc:
        raise HTTPException(204, "Tile outside bounds") from exc

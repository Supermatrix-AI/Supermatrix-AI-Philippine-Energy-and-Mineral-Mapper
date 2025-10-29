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

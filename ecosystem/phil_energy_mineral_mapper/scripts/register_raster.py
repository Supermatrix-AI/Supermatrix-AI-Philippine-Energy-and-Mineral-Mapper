from __future__ import annotations

import shutil
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
vault_web = root / "vault" / "web"
vault_web.mkdir(parents=True, exist_ok=True)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/register_raster.py /path/to/your.tif")

    src = Path(sys.argv[1]).resolve()
    if not src.exists() or src.suffix.lower() not in {".tif", ".tiff"}:
        raise SystemExit("Provide a valid .tif/.tiff file")

    dst = vault_web / src.name
    shutil.copy2(src, dst)
    rel = dst.relative_to(root)
    print(f"Registered: {rel}")
    print(
        "Open in browser with raster overlay:\n"
        f"  http://127.0.0.1:8099/?src={rel}"
    )


if __name__ == "__main__":
    main()

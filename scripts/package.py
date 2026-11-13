"""Build a portable extension package with documentation and local checks."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text())
files = ["manifest.json", "content.js", "popup.html", "popup.css", "popup.js",
         "README.md", "PRIVACY.md", "LICENSE", "CHANGELOG.md"]
files.extend(manifest["icons"].values())
files.extend(str(p.relative_to(root)) for p in (root / "docs").glob("*.md"))
# Keep README development commands usable in the downloadable package.
files.extend(["scripts/package.py", "tests/content.test.cjs"])
output = root / "dist" / ("kick-auto-claim-" + manifest["version"] + ".zip")
output.parent.mkdir(exist_ok=True)
for name in files:
    if not (root / name).is_file():
        raise FileNotFoundError(name)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(set(files)):
        archive.write(root / name, name)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert "manifest.json" in archive.namelist()
print(output)

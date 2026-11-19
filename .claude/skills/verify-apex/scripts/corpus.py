"""Write the repo's synthetic evidence into a run's corpus directory.

Usage: corpus.py <container-images.json> <corpus-dir>
Prints one JSON object that maps each evidence name to its absolute path.
"""

import base64
import gzip
import hashlib
import json
import sys
from pathlib import Path

FOLDER_FILES = {
    "README.txt": "APEX verification folder evidence.\n",
    "보고서/메모.txt": "검증용 폴더 증거입니다.\n",
    "data/numbers.csv": "n,square\n1,1\n2,4\n3,9\n",
}


def main() -> None:
    fixtures = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    corpus = Path(sys.argv[2]).resolve()
    corpus.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}
    for name, entry in fixtures.items():
        data = gzip.decompress(base64.b64decode(entry["gzip_base64"]))
        if hashlib.sha256(data).hexdigest() != entry["sha256"] or len(data) != int(entry["size"]):
            raise SystemExit(f"{name}: decoded bytes do not match the recorded hash or size")
        target = corpus / name
        target.write_bytes(data)
        target.chmod(0o444)
        paths[name] = str(target)
    folder = corpus / "folder-evidence"
    for relative, text in FOLDER_FILES.items():
        target = folder / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    paths["folder-evidence"] = str(folder)
    print(json.dumps(paths, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

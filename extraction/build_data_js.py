"""Bundle every JSON in app/data/ into a single app/data.js so the HTML works
from file:// without fetch()."""
import json
from pathlib import Path

ROOT = Path("/Users/janosfazekas/Desktop/Dutch - learnings")
DATA = ROOT / "app" / "data"
OUT = ROOT / "app" / "data.js"

bundle = {"words": {}, "grammar": {}, "verbs": {}, "sentences": [], "conversational": []}

for f in sorted((DATA / "words").glob("*.json")):
    if f.name == "_all.json": continue
    bundle["words"][f.stem] = json.loads(f.read_text(encoding="utf-8"))

for f in sorted((DATA / "grammar").glob("*.json")):
    bundle["grammar"][f.stem] = json.loads(f.read_text(encoding="utf-8"))

for f in sorted((DATA / "verbs").glob("*.json")):
    bundle["verbs"][f.stem] = json.loads(f.read_text(encoding="utf-8"))

s_file = DATA / "sentences.json"
if s_file.exists():
    bundle["sentences"] = json.loads(s_file.read_text(encoding="utf-8"))

# Curated conversational sentences with NL+EN pairs (top-100 daily-use)
sc_file = DATA / "sentences-conversational.json"
if sc_file.exists():
    bundle["conversational"] = json.loads(sc_file.read_text(encoding="utf-8"))

OUT.write_text("window.DATA = " + json.dumps(bundle, ensure_ascii=False) + ";\n", encoding="utf-8")

# print stats
print(f"Wrote {OUT}")
print(f"  word lists: {len(bundle['words'])}, total words: {sum(len(v) for v in bundle['words'].values())}")
print(f"  grammar topics: {len(bundle['grammar'])}")
print(f"  verb files: {list(bundle['verbs'].keys())}, total irregular: {len(bundle['verbs'].get('irregular', []))}")
print(f"  sentences: {len(bundle['sentences'])}")
print(f"  conversational: {len(bundle['conversational'])}")
print(f"  total size: {OUT.stat().st_size/1024:.1f} KB")

"""Parse the irregular-verbs list (eDHfA1) and the Perfectum/Imperfectum docx files
into structured verb JSON. Each verb gets:
  { id, infinitive, past_singular, past_plural, participle, aux, source }
"""
import re, json, hashlib
from pathlib import Path

ROOT = Path("/Users/janosfazekas/Desktop/Dutch - learnings")
RAW = ROOT / "extraction" / "raw"
OUT = ROOT / "app" / "data" / "verbs"
OUT.mkdir(parents=True, exist_ok=True)

NOISE_LINE = re.compile(r"^(Lijst onregelmatige.*|Infinitief Imperfectum Perfectum|Onregelmatige werkwoorden\s*\d*|\d+\s*Onregelmatige.*)\s*$", re.I)

AUX_RE = re.compile(r"\(([^)]+)\)")

def make_id(prefix, *bits):
    h = hashlib.sha1("|".join(bits).encode()).hexdigest()[:10]
    return f"{prefix}_{h}"

def parse_irregular(text: str):
    """The text is mostly: <inf> <past_sg> <past_pl> <participle> (<aux>)."""
    # collapse whitespace, drop noise
    cleaned_lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line or NOISE_LINE.match(line):
            continue
        cleaned_lines.append(line)
    flat = " ".join(cleaned_lines)
    # split into entries: each entry ends with `(...)`
    parts = re.split(r"(\([^)]+\))", flat)
    # parts is [text, "(aux)", text, "(aux)", ...]
    entries = []
    buf = ""
    for chunk in parts:
        if chunk.startswith("(") and chunk.endswith(")"):
            buf = buf.strip()
            if buf:
                tokens = buf.split()
                if len(tokens) >= 4:
                    inf, sg, pl, part = tokens[-4], tokens[-3], tokens[-2], tokens[-1]
                    aux = chunk[1:-1].strip()
                    # skip "(het)" etc that appears mid-entry (e.g. "spijten")
                    if aux.lower() not in {"het"}:
                        entries.append({
                            "id": make_id("v", inf),
                            "infinitive": inf,
                            "past_singular": sg if sg != "–" else None,
                            "past_plural": pl if pl != "–" else None,
                            "participle": part if part != "–" else None,
                            "aux": aux,
                            "irregular": True,
                            "source": "eDHfA1 onregelmatige werkwoorden",
                        })
            buf = ""
        else:
            buf += " " + chunk
    return entries

def main():
    f = RAW / "Grammar__eDHfA1-lijst_onregelmatige_werkwoorden.docx.txt"
    text = f.read_text(encoding="utf-8")
    entries = parse_irregular(text)
    out = OUT / "irregular.json"
    out.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  irregular: {len(entries)} verbs -> {out.name}")

if __name__ == "__main__":
    main()

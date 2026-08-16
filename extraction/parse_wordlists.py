"""Parse the NIG Woordenlijst .docx files into structured JSON.

Each .docx is a list of "entry paragraphs". Sometimes one logical entry spans
multiple paragraphs (long entries wrap). We merge continuations, then split
each merged paragraph on 2+ spaces (which is how multi-column rows got
flattened by Word's paragraph rendering)."""

import re, json, hashlib
from pathlib import Path
import docx as docxlib

ROOT = Path(__file__).resolve().parent.parent
WORDLISTS_DIR = ROOT / "Wordlists"
OUT = ROOT / "app" / "data" / "words"
OUT.mkdir(parents=True, exist_ok=True)

NOISE_RE = re.compile(
    r"^(\d+\s*van\s*\d+|"
    r"Woordenlijst hoofdstuk \d+.*|"
    r"Nederlands\s+Engels(\s+Eigen.*)?\s*$)",
    re.I,
)

def make_id(prefix, *bits):
    h = hashlib.sha1("|".join(bits).encode()).hexdigest()[:10]
    return f"{prefix}_{h}"

DUTCH_LEMMA_PAREN = re.compile(
    r"^(?:de|het|zich)\s+\S+|"               # "de X", "het X", "zich X"
    r"^[a-zàäéèëíïóòöúùüçñ]+(?:en|ën)$|"     # verb infinitive
    r"^\S+\s+(?:weten|hebben|zijn|doen|maken|nemen|gaan|komen|krijgen|staan|vinden|kijken|stellen|verbinden|herinneren|vervelen|vergissen|interesseren|voorbereiden|aanbieden|meekomen)$",
    re.I,
)

def looks_like_dutch_lemma(content: str) -> bool:
    return bool(DUTCH_LEMMA_PAREN.match(content.strip()))

def is_continuation(prev: str, nxt: str) -> bool:
    """Return True if `nxt` is a continuation of the previous paragraph."""
    p = prev.rstrip()
    n = nxt.strip()
    if not p or not n:
        return False
    # Unbalanced parens in prev
    if p.count("(") > p.count(")"):
        return True
    # Trailing connectors
    if re.search(r"[,/\-(]$", p):
        return True
    # Next paragraph is parens-only (Dutch lemma)
    m = re.match(r"^\((.+)\)$", n)
    if m and looks_like_dutch_lemma(m.group(1)):
        return True
    # Prev's last chunk ends with a Dutch-lemma `(...)` and has no English after.
    if p.endswith(")"):
        last_chunk = re.split(r"\s{2,}", p)[-1].strip()
        m = re.search(r"\(([^)]+)\)\s*$", last_chunk)
        if m:
            paren_content = m.group(1)
            text_before = last_chunk[: m.start()].strip()
            # Heuristic: if parens content is a Dutch lemma, this entry is incomplete.
            # If text_before is just one Dutch token (the head form), the parens hold the lemma.
            if looks_like_dutch_lemma(paren_content) and len(text_before.split()) <= 3:
                return True
    return False

def split_entry(chunk: str):
    """Split a single Dutch+English entry into (nl, en)."""
    s = re.sub(r"\s+", " ", chunk).strip()
    if not s:
        return None
    # 1. Closing-paren anchor: "X (lemma) Y..."
    m = re.match(r"^(.*?\))\s+(.+)$", s)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    # 2. Question / exclamation anchor
    m = re.match(r"^(.+?[?!])\s+(.+)$", s)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    words = s.split()
    if len(words) < 2:
        return None
    w0 = words[0].lower()
    if w0 in {"de", "het"} and len(words) >= 3:
        return f"{words[0]} {words[1]}", " ".join(words[2:])
    if w0 == "een" and len(words) >= 3:
        return f"een {words[1]}", " ".join(words[2:])
    if w0 in {"zich"} and len(words) >= 3:
        return f"{words[0]} {words[1]}", " ".join(words[2:])
    # default: 1-word Dutch, rest English
    return words[0], " ".join(words[1:])

def detect_pos(nl: str):
    nl_clean = nl.strip()
    paren = re.search(r"\(([^)]+)\)", nl_clean)
    paren_content = paren.group(1).strip() if paren else None
    if paren_content:
        if paren_content.lower().startswith(("de ", "het ")):
            parts = paren_content.split(None, 1)
            article = parts[0].lower()
            base = parts[1] if len(parts) > 1 else None
            head = re.sub(r"\s*\([^)]*\)\s*$", "", nl_clean).strip()
            # If the surface form is a plural (head ≠ lemma), prefer the singular lemma
            # as the canonical entry so de/het drills use the correct article and form.
            # E.g. "benen (het been)" → head="het been", article="het", no plural field.
            if base and head.lower() != base.lower():
                singular_nl = f"{article} {base}"
                return {"pos": "noun", "head": singular_nl, "article": article, "lemma": base}
            return {"pos": "noun", "head": head, "article": article, "lemma": base, "plural": head if head != base else None}
        if re.match(r"^[a-zàáäéèêëíìîïóòôöúùûüçñ ]+$", paren_content, re.I):
            head = re.sub(r"\s*\([^)]*\)\s*$", "", nl_clean).strip()
            inf = paren_content.lower()
            reflexive = False
            if inf.startswith("zich "):
                reflexive = True
                inf = inf[5:]
            return {"pos": "verb", "head": head, "infinitive": inf, "reflexive": reflexive}
    low = nl_clean.lower()
    if low.startswith("de "):
        return {"pos": "noun", "head": nl_clean, "article": "de", "lemma": nl_clean.split(None, 1)[1]}
    if low.startswith("het "):
        return {"pos": "noun", "head": nl_clean, "article": "het", "lemma": nl_clean.split(None, 1)[1]}
    if low.startswith("zich "):
        return {"pos": "verb", "head": nl_clean, "infinitive": nl_clean, "reflexive": True}
    if re.match(r"^[a-zàáäéèêëíìîïóòôöúùûüçñ]+$", nl_clean) and (nl_clean.endswith("en") or nl_clean.endswith("ën")):
        return {"pos": "verb", "head": nl_clean, "infinitive": nl_clean}
    if "?" in nl_clean or "!" in nl_clean:
        return {"pos": "phrase", "head": nl_clean}
    return {"pos": "other", "head": nl_clean}

def normalize_paren_spaces(s: str) -> str:
    """Collapse 2+ spaces inside (...) to single spaces, so they don't get
    interpreted as entry separators."""
    return re.sub(r"\(([^)]*)\)", lambda m: "(" + re.sub(r"\s+", " ", m.group(1)) + ")", s)

def parse_paragraphs(paragraphs):
    """Filter noise and merge continuation paragraphs."""
    cleaned = [normalize_paren_spaces(p.strip()) for p in paragraphs if p.strip() and not NOISE_RE.match(p.strip())]
    merged = []
    for p in cleaned:
        if merged and is_continuation(merged[-1], p):
            # strip trailing connectors before joining
            merged[-1] = re.sub(r"[,/\-]\s*$", " ", merged[-1]).rstrip() + " " + p
        else:
            merged.append(p)
    return merged

def parse_wordlist(paragraphs, hoofdstuk: int):
    entries = []
    seen = set()
    for line in parse_paragraphs(paragraphs):
        # Collapse internal whitespace runs except at >=2-space entry boundaries
        # We need to keep the 2+ space splitting working — DON'T collapse those.
        # Multi-space within the same paragraph still acts as entry separator.
        for chunk in re.split(r"\s{2,}", line):
            chunk = chunk.strip()
            if not chunk or NOISE_RE.match(chunk):
                continue
            res = split_entry(chunk)
            if not res:
                continue
            nl, en = res
            if not nl or not en:
                continue
            key = (nl.lower(), en.lower())
            if key in seen:
                continue
            seen.add(key)
            info = detect_pos(nl)
            entry = {
                "id": make_id("w", nl, en, str(hoofdstuk)),
                "nl": nl,
                "en": en,
                "topic": f"woordenlijst-{hoofdstuk}",
                "source": f"NIG Woordenlijst {hoofdstuk}",
                **info,
            }
            entries.append(entry)
    return entries

def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().replace("’", "'").replace("‘", "'")).strip()

def apply_overrides(entries, hoofdstuk, overrides):
    delete_pairs = {(_norm(d[0]), _norm(d[1])) for d in overrides.get("delete", [])}
    delete_global = overrides.get("delete_global", {}).get(str(hoofdstuk), [])
    delete_nl = {_norm(x) for x in delete_global}
    entries = [
        e for e in entries
        if _norm(e["nl"]) not in delete_nl
        and (_norm(e["nl"]), _norm(e["en"])) not in delete_pairs
    ]
    add = overrides.get("add_to", {}).get(str(hoofdstuk), [])
    for a in add:
        a = dict(a)
        a.setdefault("topic", f"woordenlijst-{hoofdstuk}")
        a.setdefault("source", f"NIG Woordenlijst {hoofdstuk}")
        a["id"] = make_id("w", a["nl"], a["en"], str(hoofdstuk))
        entries.append(a)
    return entries

def main():
    overrides_path = ROOT / "extraction" / "wordlist_overrides.json"
    overrides = json.loads(overrides_path.read_text(encoding="utf-8")) if overrides_path.exists() else {}
    summary = {}
    for h in range(9, 15):
        f = WORDLISTS_DIR / f"NIG - Woordenlijst {h} (EN).docx"
        if not f.exists():
            continue
        d = docxlib.Document(f)
        paragraphs = [p.text for p in d.paragraphs]
        entries = parse_wordlist(paragraphs, h)
        entries = apply_overrides(entries, h, overrides)
        out = OUT / f"woordenlijst-{h}.json"
        out.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
        summary[h] = len(entries)
        print(f"  hoofdstuk {h}: {len(entries)} entries -> {out.name}")
    all_entries = []
    for h in summary:
        all_entries += json.loads((OUT / f"woordenlijst-{h}.json").read_text(encoding="utf-8"))
    (OUT / "_all.json").write_text(json.dumps(all_entries, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Total: {len(all_entries)} entries")

if __name__ == "__main__":
    main()

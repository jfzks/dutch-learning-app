"""Turn hand-typed lesson notes into a wordlist JSON the app can drill.

Input:  extraction/lessons/<YYYY-MM-DD>.tsv  — `nl <TAB> en [<TAB> pos]` per line,
        `#` comments and blank lines ignored.
Output: app/data/words/lesson-<YYYY-MM-DD>.json

Entries whose Dutch head already exists in another wordlist (or earlier in the
same file) are skipped, so re-running never duplicates a word. Same entry shape
as parse_wordlists.py, so the app treats these lists like any other.
"""
import json, re, sys, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LESSONS = ROOT / "extraction" / "lessons"
OUT = ROOT / "app" / "data" / "words"


def make_id(prefix, *bits):
    h = hashlib.sha1("|".join(bits).encode()).hexdigest()[:10]
    return f"{prefix}_{h}"


def detect_pos(nl: str):
    """Same conventions as parse_wordlists.detect_pos: `de/het X` → noun,
    `plural (de singular)` → noun keyed on the singular, `zich X` → reflexive verb."""
    nl_clean = nl.strip()
    paren = re.search(r"\(([^)]+)\)", nl_clean)
    paren_content = paren.group(1).strip() if paren else None
    if paren_content and paren_content.lower().startswith(("de ", "het ")):
        article, base = paren_content.split(None, 1)
        article = article.lower()
        head = re.sub(r"\s*\([^)]*\)\s*$", "", nl_clean).strip()
        if head.lower() != base.lower():
            return {"pos": "noun", "head": f"{article} {base}", "article": article,
                    "lemma": base, "plural": head}
        return {"pos": "noun", "head": head, "article": article, "lemma": base}
    low = nl_clean.lower()
    if low.startswith(("de ", "het ")):
        article, base = nl_clean.split(None, 1)
        return {"pos": "noun", "head": nl_clean, "article": article.lower(), "lemma": base}
    if low.startswith("zich "):
        return {"pos": "verb", "head": nl_clean, "infinitive": nl_clean[5:], "reflexive": True}
    if re.match(r"^[a-zàáäéèêëíìîïóòôöúùûüçñ]+(en|ën)$", low):
        return {"pos": "verb", "head": nl_clean, "infinitive": low}
    if "?" in nl_clean or "!" in nl_clean:
        return {"pos": "phrase", "head": nl_clean}
    return {"pos": "other", "head": nl_clean}


def norm(s: str) -> str:
    s = s.lower().replace("’", "'").replace("‘", "'")
    s = re.sub(r"\([^)]*\)", " ", s)          # drop lemma hints
    s = re.sub(r"^(de|het|zich)\s+", "", s.strip())
    return re.sub(r"[^a-zàáäéèêëíìîïóòôöúùûüçñ' ]", "", s).strip()


def keys_of(entry) -> set:
    """Every spelling this entry should be recognised by, for overlap checks."""
    out = set()
    for v in (entry.get("nl"), entry.get("head"), entry.get("lemma"),
              entry.get("infinitive"), entry.get("plural")):
        if v:
            out.add(norm(v))
    return {k for k in out if k}


def existing_keys(skip_topics):
    seen = {}
    for f in sorted(OUT.glob("*.json")):
        if f.name == "_all.json" or f.stem in skip_topics:
            continue
        for e in json.loads(f.read_text(encoding="utf-8")):
            for k in keys_of(e):
                seen.setdefault(k, e)
    return seen


def read_lesson(path: Path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        cols = [c.strip() for c in line.split("\t")]
        if len(cols) < 2 or not cols[0] or not cols[1]:
            print(f"  ! skipped unparsable line: {line!r}")
            continue
        rows.append((cols[0], cols[1], cols[2] if len(cols) > 2 else ""))
    return rows


def build(date: str):
    src = LESSONS / f"{date}.tsv"
    topic = f"lesson-{date}"
    entries, skipped = [], []
    seen = existing_keys({topic})
    for nl, en, pos in read_lesson(src):
        info = detect_pos(nl)
        if pos:
            info["pos"] = pos
        entry = {"id": make_id("w", nl, en, topic), "nl": nl, "en": en, "topic": topic,
                 "source": f"Lesson notes {date}", **info}
        entry = {k: v for k, v in entry.items() if v is not None}
        keys = keys_of(entry)
        clash = next((seen[k] for k in keys if k in seen), None)
        if clash:
            skipped.append((nl, en, clash))
            continue
        if entry["pos"] == "verb" and "infinitive" not in entry:
            # `uitgaan`, `klagen over` — head verb is the first token. Derived after
            # the clash check so a collocation isn't shadowed by its bare verb.
            entry["infinitive"] = re.sub(r"^zich\s+", "", nl.lower()).split()[0]
        for k in keys:
            seen[k] = entry
        entries.append(entry)
    (OUT / f"{topic}.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{topic}.json — {len(entries)} added, {len(skipped)} skipped as duplicates")
    for nl, en, clash in skipped:
        print(f"  skip {nl!r} ({en}) — already in {clash['topic']} as {clash['nl']!r} = {clash['en']!r}")
    return entries


def file_order(f: Path):
    """Course wordlists first in chapter order, then lessons by date — so
    _all.json keeps the order parse_wordlists.py produced."""
    m = re.match(r"woordenlijst-(\d+)$", f.stem)
    return (0, int(m.group(1)), "") if m else (1, 0, f.stem)


def rebuild_all():
    everything = []
    for f in sorted(OUT.glob("*.json"), key=file_order):
        if f.name == "_all.json":
            continue
        everything.extend(json.loads(f.read_text(encoding="utf-8")))
    (OUT / "_all.json").write_text(
        json.dumps(everything, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"_all.json — {len(everything)} words total")


if __name__ == "__main__":
    dates = sys.argv[1:] or sorted(p.stem for p in LESSONS.glob("*.tsv"))
    for d in dates:
        build(d)
    rebuild_all()

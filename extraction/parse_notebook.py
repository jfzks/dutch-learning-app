"""Build the notebook wordlists from the Pages document 'Dutch A1/A2'.

Input:
  extraction/notebook_raw.json       verbatim dump of the .pages tables + inline notes
  extraction/notebook_overrides.json spelling fixes, missing glosses, merges, drops

Output:
  app/data/words/notitieboek-2026-05.json … notitieboek-2026-08.json

The raw dump is deliberately never edited by hand: everything that changes a
Dutch or English string is recorded in the overrides file with a `why`, so the
notebook can be re-extracted and re-curated without losing the audit trail.

Usage: python3 extraction/parse_notebook.py [--dry-run]
"""
from __future__ import annotations
import json, hashlib, re, sys, argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "extraction" / "notebook_raw.json"
OVERRIDES = ROOT / "extraction" / "notebook_overrides.json"
OUT = ROOT / "app" / "data" / "words"

# The notebook is written newest-first and dates are bare day+month.
MONTHS = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "Mai": 5, "May": 5, "Jun": 6,
          "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
YEAR = 2026

# Verbs whose infinitive form we want recorded so the conjugation drill and the
# verb-gloss lookup can find them. Anything ending in -en that is a single token
# is treated as an infinitive; these are the multi-word or irregular exceptions.
NOT_A_VERB = {
    "de aantekeningen", "de bladgroenten", "de eetgewoonten", "de gebieden",
    "de kennissen", "de medereizigers", "de huisgenoten", "de duiven",
    "de spieren", "de zintuigen", "de nadelen", "de vooroordelen", "de voornemens",
    "de documentaires", "de schappen", "de kwasten", "de doelpunten", "de spullen (= dingen)",
    "de gezondheidsklachten", "de ziektecijfers", "de sterftecijfers", "de geliefde",
    "de bijwerkingen", "voor- en nadelen", "tientallen", "de gelijkgestemden",
}


def parse_date(label: str) -> tuple[int, int]:
    m = re.match(r"(\d+)\s*(?:st|nd|rd|th)?\s*([A-Za-z]{3})", label)
    if not m:
        raise ValueError(f"unparseable date label: {label!r}")
    return MONTHS[m.group(2)], int(m.group(1))


def word_id(nl: str, topic: str) -> str:
    return "w_" + hashlib.sha1(f"{nl}|{topic}".encode("utf-8")).hexdigest()[:10]


def classify(nl: str, override: dict) -> dict:
    """Derive pos / article / lemma / infinitive from the (corrected) Dutch."""
    out: dict = {}
    art = re.match(r"^(de|het)\s+(.+)$", nl)
    if art and " " not in art.group(2).strip():
        out["pos"] = "noun"
        out["article"] = art.group(1)
        out["lemma"] = art.group(2).strip()
        return out
    if override.get("infinitive"):
        out["pos"] = "verb"
        out["infinitive"] = override["infinitive"]
        if override.get("reflexive"):
            out["reflexive"] = True
        return out
    bare = re.sub(r"\s*\(.*?\)\s*", " ", nl).strip()
    tokens = bare.split()
    if override.get("reflexive"):
        out["pos"] = "verb"
        out["reflexive"] = True
        inf = next((t for t in tokens if t.endswith("en") and t != "zich"), None)
        if inf:
            out["infinitive"] = inf
        return out
    if len(tokens) == 1 and tokens[0].endswith("en") and nl not in NOT_A_VERB and len(tokens[0]) > 3:
        out["pos"] = "verb"
        out["infinitive"] = tokens[0]
        return out
    out["pos"] = "phrase" if len(tokens) > 2 else "other"
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    raw = json.loads(RAW.read_text(encoding="utf-8"))
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    overrides.pop("_readme", None)

    rows = raw["tables"] + raw["inline"]

    seen_keys: dict[str, int] = {}
    entries: list[dict] = []
    dropped: list[tuple[str, str]] = []
    unused = set(overrides)

    for row in rows:
        date, nl_raw, en_raw = row["date"], (row["nl"] or ""), (row["en"] or "")
        key = f"{date}||{nl_raw}"
        # A handful of raw cells repeat verbatim within one date; the overrides
        # file addresses the second occurrence as "…#2".
        seen_keys[key] = seen_keys.get(key, 0) + 1
        if seen_keys[key] > 1:
            numbered = f"{key}#{seen_keys[key]}"
            if numbered in overrides:
                key = numbered
        ov = overrides.get(key, {})
        unused.discard(key)

        if ov.get("drop"):
            dropped.append((key, ov.get("why", "")))
            continue

        nl = (ov.get("nl") or nl_raw).strip()
        en = (ov.get("en") or en_raw).strip()
        if not nl or not en:
            dropped.append((key, "no NL/EN pair after overrides"))
            continue

        month, day = parse_date(date)
        topic = f"notitieboek-{YEAR}-{month:02d}"
        entry = {
            "id": word_id(nl, topic),
            "nl": nl,
            "en": en,
            "topic": topic,
            "source": f"Notitieboek — {day} {date.split()[-1]} {YEAR}",
            "head": nl,
        }
        entry.update(classify(nl, ov))
        if ov.get("example"):
            entry["example"] = ov["example"]
        entries.append(entry)

    # Merge entries that ended up with the same Dutch headword in the same topic.
    merged: dict[str, dict] = {}
    for e in entries:
        k = f"{e['topic']}||{e['nl'].lower()}"
        if k in merged:
            prev = merged[k]
            if e["en"].lower() != prev["en"].lower():
                prev["en"] = prev["en"] + " / " + e["en"]
            continue
        merged[k] = e
    entries = list(merged.values())

    by_topic: dict[str, list[dict]] = {}
    for e in entries:
        by_topic.setdefault(e["topic"], []).append(e)

    if args.dry_run:
        print("(dry-run: no files written)")
    else:
        for topic, items in sorted(by_topic.items()):
            path = OUT / f"{topic}.json"
            path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"  wrote {path.relative_to(ROOT)}  ({len(items)} words)")

    print()
    print(f"raw rows      : {len(rows)}")
    print(f"dropped       : {len(dropped)}")
    print(f"merged dupes  : {len(entries)} unique of {len(rows) - len(dropped)} kept")
    print(f"total written : {len(entries)}")
    if unused:
        print()
        print(f"!! {len(unused)} override key(s) matched nothing — check for typos:")
        for k in sorted(unused):
            print(f"     {k}")


if __name__ == "__main__":
    main()

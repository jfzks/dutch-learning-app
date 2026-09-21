#!/usr/bin/env python3
"""Check the batch files for the mistakes that break the app or the schedule.

Run it after editing or adding a batch:

    python3 top2000/tools/check_batches.py

Checks: ranks are unique and contiguous across all batches, each batch covers
the range it claims, no Dutch lemma appears twice, and every word carries the
fields its type requires (verbs a full present tense, a past singular/plural
and a perfect with a 'heeft'/'is' auxiliary; nouns a de/het article and a
plural; adjectives an inflected form and two example uses). Exits non-zero and
lists every problem it found.
"""

import json
import pathlib
import sys

DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"
TYPES = {"verb", "noun", "adjective", "other"}


def check_word(w, where, problems):
    def fail(msg):
        problems.append(f"{where}: {msg}")

    for field in ("rank", "dutch", "english", "type", "example"):
        if not w.get(field):
            fail(f"missing {field!r}")
            return

    if w["type"] not in TYPES:
        fail(f"unknown type {w['type']!r}")
        return

    ex = w["example"]
    if not isinstance(ex, dict) or not ex.get("nl") or not ex.get("en"):
        fail("example needs both nl and en")

    forms = w.get("forms")
    if w["type"] == "other":
        if forms:
            fail("type 'other' should not have forms")
        return
    if not isinstance(forms, dict):
        fail("missing forms")
        return

    if w["type"] == "verb":
        present = forms.get("present")
        if not isinstance(present, dict):
            fail("verb needs forms.present")
        else:
            for person in ("ik", "jij", "hij", "wij"):
                if not present.get(person):
                    fail(f"present is missing {person!r}")
        past = forms.get("past")
        if not isinstance(past, dict) or not past.get("singular") or not past.get("plural"):
            fail("verb needs past.singular and past.plural")
        if "perfect" not in forms:
            fail("verb needs a perfect (use null for verbs without one)")
        else:
            perfect = forms["perfect"]
            if perfect is not None and not perfect.startswith(("heeft ", "is ")):
                fail(f"perfect {perfect!r} should start with 'heeft ' or 'is '")
    elif w["type"] == "noun":
        if forms.get("article") not in ("de", "het"):
            fail(f"article {forms.get('article')!r} should be 'de' or 'het'")
        if not forms.get("plural"):
            fail("noun needs a plural")
    elif w["type"] == "adjective":
        if not forms.get("inflected"):
            fail("adjective needs an inflected form")
        if len(forms.get("examples") or []) != 2:
            fail("adjective needs exactly two example uses (a de-word and a het-word)")


def main() -> int:
    files = sorted(DATA_DIR.glob("batch-*.json"))
    if not files:
        print(f"No batch-*.json files in {DATA_DIR}", file=sys.stderr)
        return 1

    problems = []
    ranks = {}
    lemmas = {}
    total = 0

    for path in files:
        try:
            batch = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            problems.append(f"{path.name}: invalid JSON — {e}")
            continue

        words = batch.get("words")
        if not isinstance(words, list) or not words:
            problems.append(f"{path.name}: no words")
            continue
        total += len(words)

        lo, hi = (batch.get("range") or [None, None])
        for w in words:
            where = f"{path.name} #{w.get('rank', '?')} {w.get('dutch', '?')}"
            check_word(w, where, problems)

            rank = w.get("rank")
            if rank in ranks:
                problems.append(f"{where}: rank already used in {ranks[rank]}")
            else:
                ranks[rank] = path.name
            if lo is not None and isinstance(rank, int) and not (lo <= rank <= hi):
                problems.append(f"{where}: rank outside the batch range {lo}–{hi}")

            key = (w.get("dutch") or "").lower()
            if key in lemmas:
                problems.append(f"{where}: duplicate of {lemmas[key]}")
            else:
                lemmas[key] = where

    numbers = sorted(r for r in ranks if isinstance(r, int))
    if numbers:
        missing = sorted(set(range(numbers[0], numbers[-1] + 1)) - set(numbers))
        if missing:
            preview = ", ".join(str(m) for m in missing[:20])
            problems.append(f"gaps in the rank sequence: {preview}{' …' if len(missing) > 20 else ''}")

    if problems:
        print(f"{len(problems)} problem(s):", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1

    print(f"OK — {len(files)} batch(es), {total} words, ranks {numbers[0]}–{numbers[-1]}, no duplicates.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

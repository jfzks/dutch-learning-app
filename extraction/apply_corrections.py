"""Apply a corrections.json (produced by Claude reviewing flagged items)
to the source JSON files in app/data/, then rebuild app/data.js.

Usage: python3 extraction/apply_corrections.py path/to/corrections.json [--dry-run]

Schema of each correction:
  {
    "flagId": "f_xxxxxxxx",
    "file": "app/data/words/woordenlijst-11.json",
    "action": "replace" | "delete" | "add" | "noop",
    "match":   { "id": "..." } OR { "nl": "...", "en": "..." } OR a deeper path,
    "replace": { ...partial fields to merge in... },     # for "replace"
    "entry":   { ...full new entry... },                 # for "add"
    "rationale": "Why."
  }

Idempotent: if "match" doesn't find an entry that needs the change, the
correction is skipped (replace/delete on already-fixed data is a no-op).
The script will refuse to apply ambiguous matches (>1 candidate)."""
from __future__ import annotations
import json, sys, argparse, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))

def save_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def matches(entry, match) -> bool:
    if not isinstance(match, dict):
        return False
    for k, v in match.items():
        eval_ = entry.get(k)
        if isinstance(v, str) and isinstance(eval_, str):
            if v.strip().lower() != eval_.strip().lower():
                return False
        elif eval_ != v:
            return False
    return True

def apply_to_list(entries, c):
    """Mutate `entries` in-place. Returns ('applied' | 'skipped' | 'ambiguous', message)."""
    action = c.get("action", "replace")
    if action == "noop":
        return "applied", "noop"
    if action == "add":
        new_entry = c.get("entry")
        if not new_entry:
            return "skipped", "add: missing 'entry'"
        # if an entry with the same id already exists, treat as already-applied
        if isinstance(new_entry, dict) and "id" in new_entry:
            if any(e.get("id") == new_entry["id"] for e in entries):
                return "skipped", f"add: entry with id={new_entry['id']} already exists (idempotent)"
        entries.append(new_entry)
        return "applied", f"added entry {new_entry.get('id') or new_entry.get('nl', '?')}"
    match = c.get("match") or {}
    candidates = [i for i, e in enumerate(entries) if matches(e, match)]
    if len(candidates) == 0:
        # already applied or never matched — idempotent skip
        return "skipped", f"{action}: no entry matched {match} (already applied?)"
    if len(candidates) > 1:
        return "ambiguous", f"{action}: {len(candidates)} entries match {match}; refusing"
    idx = candidates[0]
    if action == "delete":
        del entries[idx]
        return "applied", f"deleted entry at {idx}"
    if action == "replace":
        repl = c.get("replace") or {}
        remove = c.get("remove") or []
        if not repl and not remove:
            return "skipped", "replace: no fields to update"
        # Idempotent skip: every replace field already matches AND every remove field is absent.
        repl_already = all(entries[idx].get(k) == v for k, v in repl.items())
        remove_already = all(k not in entries[idx] for k in remove)
        if repl_already and remove_already:
            return "skipped", "replace: target already has these values"
        if repl:
            entries[idx] = {**entries[idx], **repl}
        for k in remove:
            entries[idx].pop(k, None)
        changed = list(repl.keys()) + [f"-{k}" for k in remove]
        return "applied", f"replaced fields {changed}"
    return "skipped", f"unknown action: {action}"

def apply_to_grammar(data, c):
    """Grammar files are objects, not arrays. We only support edits to `examples`
    by `nl` match for now."""
    examples = data.get("examples")
    if not isinstance(examples, list):
        return "skipped", "grammar: file has no 'examples' array"
    return apply_to_list(examples, c)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("corrections", help="path to corrections.json")
    ap.add_argument("--dry-run", action="store_true", help="show what would change but don't write")
    ap.add_argument("--no-bundle", action="store_true", help="skip rebuilding app/data.js after writing")
    args = ap.parse_args()

    corrections = json.loads(Path(args.corrections).read_text(encoding="utf-8"))
    if not isinstance(corrections, list):
        sys.exit("corrections.json must be a JSON array")

    by_file: dict[str, list[dict]] = {}
    for c in corrections:
        f = c.get("file")
        if not f:
            print(f"  skip: missing 'file' in {c.get('flagId')}")
            continue
        by_file.setdefault(f, []).append(c)

    counts = {"applied": 0, "skipped": 0, "ambiguous": 0, "errors": 0}
    for rel_path, cs in by_file.items():
        path = ROOT / rel_path
        if not path.exists():
            print(f"!!  {rel_path}: file does not exist; skipping {len(cs)} correction(s)")
            counts["errors"] += len(cs)
            continue
        data = load_json(path)
        is_array = isinstance(data, list)
        for c in cs:
            try:
                if is_array:
                    status, msg = apply_to_list(data, c)
                else:
                    status, msg = apply_to_grammar(data, c)
            except Exception as e:
                status, msg = "errors", f"exception: {e}"
            counts[status] = counts.get(status, 0) + 1
            tag = {"applied": "✓", "skipped": "·", "ambiguous": "?", "errors": "!"}[status]
            print(f"  {tag} {rel_path} [{c.get('flagId', '?')}] {c.get('action', 'replace')}: {msg}")
        if not args.dry_run:
            save_json(path, data)

    print()
    print(f"Summary: {counts.get('applied', 0)} applied, {counts.get('skipped', 0)} skipped, "
          f"{counts.get('ambiguous', 0)} ambiguous, {counts.get('errors', 0)} errors")

    if args.dry_run:
        print("(dry-run: no files were written)")
        return

    if not args.no_bundle:
        bundler = ROOT / "extraction" / "build_data_js.py"
        if bundler.exists():
            print()
            print("Rebuilding app/data.js …")
            subprocess.run([sys.executable, str(bundler)], check=True)

if __name__ == "__main__":
    main()

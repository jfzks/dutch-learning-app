"""Harvest Dutch sentences from Homework and Other Materials, tag them, write JSON."""
import re, json, hashlib
from pathlib import Path

ROOT = Path("/Users/janosfazekas/Desktop/Dutch - learnings")
RAW = ROOT / "extraction" / "raw"
OUT = ROOT / "app" / "data" / "sentences.json"

DUTCH_HINT = re.compile(r"\b(de|het|een|ik|jij|hij|zij|wij|jullie|wij|wat|hoe|waar|wanneer|waarom|met|aan|naar|van|bij|in|op|over|onder|voor|achter|tegen|tussen)\b", re.I)
ENGLISH_HINT = re.compile(r"\b(the|and|with|this|that|have|are|will|when|where|why|how|what|because|but|for|to)\b", re.I)
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z“„])|(?<=[.!?])\s*$")
DROP_LINE = re.compile(r"^\s*(\d+\s*van\s*\d+|page\s*\d+|opdracht\s*\d+.*|hoofdstuk\s*\d+.*|voorbeeld:?|\d+\.|^\s*-\s*$)\s*$", re.I)
# English-only instruction / metadata lines we want to drop
ENGLISH_ONLY = re.compile(r"^(preposition|subject|verb|noun|object|adjective|adverb|instructions?|note|example):", re.I)
# Strip leading prompt formatting like "Wat – gegeten →" or "Bruiloft = wedding →"
PROMPT_PREFIX = re.compile(r"^[^.!?→=]{0,40}\s*[→=]\s*", re.I)

PERFECTUM_AUX = re.compile(r"\b(heb|hebt|heeft|hebben|ben|bent|is|zijn)\b", re.I)
PARTICIPLE = re.compile(r"\bge[a-zàäéèëíìïóòöúùüç]+(?:t|d|en)\b", re.I)
NO_GE_PARTICIPLE = re.compile(r"\b(?:be|ver|her|ont|ge|er)[a-zàäéèëíìïóòöúùüç]+(?:t|d|en)\b", re.I)
MODAL = re.compile(r"\b(kan|kunt|kunnen|wil|wilt|willen|moet|moeten|mag|mogen|zal|zult|zullen|zou|zouden|hoef|hoeft|hoeven|gaat|gaan|ga|wou)\b", re.I)
SUBCLAUSE = re.compile(r"\b(omdat|als|dat|terwijl|wanneer|voordat|nadat|hoewel|zodat)\b", re.I)
COORD = re.compile(r"\b(want|maar|dus|of|en)\b", re.I)
QUESTION_WORD = re.compile(r"^\s*(wat|wie|waar|wanneer|hoe|waarom|welke|welk)\b", re.I)
TIME_INVERSION = re.compile(r"^\s*(morgen|gisteren|vandaag|nu|straks|vanavond|vanmiddag|vanmorgen|altijd|nooit|soms|misschien|vorig[ae]?|volgende|in de|op de|elke|elk|tijdens|na|voor|na de|in|op)\b", re.I)
REFLEXIVE_PRON = re.compile(r"\b(me|je|zich|ons)\b", re.I)
SEPARABLE_PREFIX_END = re.compile(r"\b(uit|op|in|aan|af|mee|voor|terug|weg|door|over|samen|tegen|bij|na|om|neer|thuis|stil|los|vast)\.?\s*[?!.]?\s*$", re.I)
IMPERFECTUM_REGULAR = re.compile(r"\b[a-z]{2,}(?:te|den|ten|de)\b", re.I)
IRREGULAR_PAST = None  # filled later from verbs JSON

def make_id(s):
    return "s_" + hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]

def is_likely_dutch(s):
    if len(s) < 3: return False
    if not re.search(r"[a-z]", s): return False
    dh = len(DUTCH_HINT.findall(s))
    eh = len(ENGLISH_HINT.findall(s))
    return dh >= 1 and dh >= eh - 1

def tag_sentence(s, irregular_pasts):
    s_low = s.lower()
    tags = set()
    has_aux = bool(PERFECTUM_AUX.search(s))
    has_part = bool(PARTICIPLE.search(s) or NO_GE_PARTICIPLE.search(s))
    if has_aux and has_part:
        tags.add("perfectum")
    if MODAL.search(s):
        tags.add("modal")
    if SUBCLAUSE.search(s):
        tags.add("subclause")
    if COORD.search(s):
        tags.add("coordination")
    if QUESTION_WORD.search(s):
        tags.add("wh-question")
    if s.strip().endswith("?"):
        tags.add("question")
    if TIME_INVERSION.search(s):
        tags.add("inversion-candidate")
    if REFLEXIVE_PRON.search(s):
        tags.add("reflexive-candidate")
    if SEPARABLE_PREFIX_END.search(s):
        tags.add("separable-candidate")
    # imperfectum: irregular past forms or regular -te/-de pattern (avoid present forms)
    words = re.findall(r"\b[a-zàäéèëíìïóòöúùüç]+\b", s_low)
    if any(w in irregular_pasts for w in words):
        tags.add("imperfectum")
    return sorted(tags)

def split_sentences(text):
    out = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or DROP_LINE.match(line): continue
        if "===== PAGE" in line or "===== TABLE" in line: continue
        if ENGLISH_ONLY.match(line): continue
        parts = re.split(r"(?<=[.!?])\s+", line)
        for p in parts:
            p = p.strip().strip("•-–—·").strip()
            if not p: continue
            # Strip a leading homework-prompt prefix ("Wat – gegeten → " etc.)
            for _ in range(3):
                stripped = PROMPT_PREFIX.sub("", p, count=1).strip()
                if not stripped or stripped == p:
                    break
                p = stripped
            if len(p.split()) < 3: continue
            if not re.search(r"[.!?]\s*$", p):
                continue
            out.append(p)
    return out

def main():
    # load irregular past forms
    irreg = json.loads((ROOT / "app" / "data" / "verbs" / "irregular.json").read_text(encoding="utf-8"))
    irregular_pasts = set()
    for v in irreg:
        for f in (v.get("past_singular"), v.get("past_plural")):
            if f and f != "–":
                irregular_pasts.add(f.lower())

    sentences = []
    seen = set()
    sources = []
    for f in sorted(RAW.iterdir()):
        if not f.name.startswith(("Homework__", "Other_Materials__")): continue
        text = f.read_text(encoding="utf-8")
        for s in split_sentences(text):
            if not is_likely_dutch(s): continue
            key = s.lower()
            if key in seen: continue
            seen.add(key)
            tags = tag_sentence(s, irregular_pasts)
            sentences.append({
                "id": make_id(s),
                "nl": s,
                "tags": tags,
                "source": f.name.replace(".txt", "").replace("__", " / "),
            })
        sources.append(f.name)

    OUT.write_text(json.dumps(sentences, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Extracted {len(sentences)} sentences from {len(sources)} files -> {OUT.name}")
    # Tag stats
    from collections import Counter
    c = Counter()
    for s in sentences:
        for t in s["tags"]:
            c[t] += 1
    for tag, n in c.most_common():
        print(f"  {tag}: {n}")

if __name__ == "__main__":
    main()

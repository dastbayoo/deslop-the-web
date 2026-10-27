// Scores a block of text against the slop patterns. Pure function, no DOM,
// so it can be unit-tested in Node.

const DESLOP_DEFAULT_CUSTOM_WEIGHT = 3;

function deslopEscapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Custom phrase syntax, one per line:
//   some phrase            -> literal, word-bounded, weight 3
//   some phrase | 2        -> literal with explicit weight
//   /regex source/ | 4     -> raw regex (case-insensitive)
//   # comment              -> ignored
function deslopParseCustom(text) {
  const out = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let body = line;
    let weight = DESLOP_DEFAULT_CUSTOM_WEIGHT;
    const m = line.match(/^(.*?)\s*\|\s*(\d+(?:\.\d+)?)\s*$/);
    if (m) {
      body = m[1];
      weight = parseFloat(m[2]);
    }
    let source;
    if (body.length > 2 && body.startsWith("/") && body.endsWith("/")) {
      source = body.slice(1, -1);
    } else {
      source = "\\b" + deslopEscapeRegex(body).replace(/'/g, "['’]").replace(/\s+/g, "\\s+") + "\\b";
    }
    out.push(["custom: " + body, source, weight]);
  }
  return out;
}

const DESLOP_LIST_MAGIC = "## deslop-list v1";
const DESLOP_LIST_SEP = " | ";

// Parses lists/slop-list.txt (or a remote copy of it).
// Returns { patterns: [label, regex, weight][], snips: [label, regex, scope][], errors: string[] }.
// Throws if the text isn't a deslop list at all (e.g. an HTML login page).
function deslopParseList(text) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines[0].trim() !== DESLOP_LIST_MAGIC) throw new Error("not a deslop list (first line must be \"" + DESLOP_LIST_MAGIC + "\")");
  const patterns = [];
  const snips = [];
  const errors = [];
  let section = null;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const sec = line.match(/^\[(patterns|snips)\]$/);
    if (sec) { section = sec[1]; return; }
    const a = line.indexOf(DESLOP_LIST_SEP);
    const b = a < 0 ? -1 : line.indexOf(DESLOP_LIST_SEP, a + DESLOP_LIST_SEP.length);
    if (!section || b < 0) { errors.push(`line ${i + 1}: expected "x | label | regex"`); return; }
    const head = line.slice(0, a).trim();
    const label = line.slice(a + DESLOP_LIST_SEP.length, b).trim();
    const source = line.slice(b + DESLOP_LIST_SEP.length).trim();
    try {
      new RegExp(source, "giu");
    } catch (e) {
      errors.push(`line ${i + 1} (${label}): ${e.message}`);
      return;
    }
    if (section === "patterns") {
      const weight = Number(head);
      if (!(weight > 0)) { errors.push(`line ${i + 1} (${label}): weight must be a positive number`); return; }
      patterns.push([label, source, weight]);
    } else {
      if (head !== "always" && head !== "sloppy") { errors.push(`line ${i + 1} (${label}): scope must be always or sloppy`); return; }
      snips.push([label, source, head]);
    }
  });
  return { patterns, snips, errors };
}

function deslopCompile(patterns) {
  const compiled = [];
  for (const [label, source, weight] of patterns) {
    try {
      compiled.push({ label, re: new RegExp(source, "giu"), weight });
    } catch (e) {
      console.warn("[deslop] bad pattern skipped:", label, e.message);
    }
  }
  return compiled;
}

// Returns { score, threshold, words, hits: [{label, count, weight}] }.
// A pattern counts at most twice per paragraph so one repeated buzzword
// can't sink an otherwise normal paragraph on its own.
// The threshold grows slowly with length: weak markers accumulate naturally
// in long human-written paragraphs.
function deslopScore(text, compiled, heuristics, baseThreshold) {
  const words = (text.match(/\S+/g) || []).length;
  const hits = [];
  let score = 0;
  for (const { label, re, weight } of compiled) {
    re.lastIndex = 0;
    const count = (text.match(re) || []).length;
    if (count) {
      const capped = Math.min(count, 2);
      score += weight * capped;
      hits.push({ label, count, weight });
    }
  }
  for (const h of heuristics || []) {
    const r = h(text);
    if (r) {
      score += r[1];
      hits.push({ label: r[0], count: 1, weight: r[1] });
    }
  }
  hits.sort((a, b) => b.weight - a.weight);
  const threshold = baseThreshold + Math.floor(words / 150);
  return { score, threshold, words, hits };
}

if (typeof module !== "undefined") {
  module.exports = { deslopParseList, deslopParseCustom, deslopCompile, deslopScore, DESLOP_LIST_MAGIC };
}

// Structural slop heuristics that a phrase list cannot express: rhythm, punctuation,
// fragments. The phrase list itself lives in lists/slop-list.txt.

// Splits text into rough sentences (good enough for rhythm heuristics).
function deslopSentences(text) {
  // Don't split after titles, common abbreviations or single initials ("J. R.").
  return text
    .split(/(?<!\b(?:Mr|Mrs|Ms|Dr|St|Prof|Jr|Sr|vs|etc|e\.g|i\.e|No|Fig|Mt|Capt|Col|Gen|Lt|Rev|[A-Z])\.)(?<=[.!?…])\s+(?=[“"'(]?[A-Z0-9])/)
    .map((s) => s.trim()).filter(Boolean);
}

// Structural heuristics applied on top of the phrase list.
// Each returns a [label, weight] pair or null.
const DESLOP_HEURISTICS = [
  // Dash abuse: em-dashes and spaced en-dashes, by count and by density, so
  // short paragraphs with two dashes count too.
  (text) => {
    const n = (text.match(/—|\s–\s/g) || []).length;
    const words = (text.match(/\S+/g) || []).length || 1;
    const per100 = (n / words) * 100;
    const w = n >= 5 ? 2 : n >= 3 || (n >= 2 && per100 >= 3) ? 1 : 0;
    return w ? ["dash overload (" + n + ")", w] : null;
  },
  // "Not X. Not Y. Not Z." anaphoric fragments
  (text) => {
    let run = 0, best = 0;
    for (const s of deslopSentences(text)) {
      const short = (s.match(/\S+/g) || []).length <= 8;
      run = short && /^(?:not|no|never|zero)\b/i.test(s) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best >= 2 ? ["'Not X. Not Y.' fragments (" + best + ")", 3] : null;
  },
  // Telegram style: most sentences are tiny fragments
  (text) => {
    const sentences = deslopSentences(text);
    // Only declarative fragments count. Digits mean citations, dates or specs;
    // questions, exclamations and quotes are dialogue, where short lines are normal.
    const short = sentences.filter((s) => (s.match(/\S+/g) || []).length <= 4 &&
      !/[\d?!“”"]/.test(s)).length;
    return short >= 3 && short / sentences.length >= 0.5 ? ["telegram-style fragments (" + short + ")", 2] : null;
  },
  // Semicolon cascades glued with dashes
  (text) => {
    const semis = (text.match(/;/g) || []).length;
    const dashes = (text.match(/—|\s–\s/g) || []).length;
    return semis >= 2 && dashes >= 1 ? ["semicolon + dash cascade", 1] : null;
  },
  // Rocket-ship emoji bullets
  (text) => {
    const n = (text.match(/[🚀✨💡🔥👉✅🎯📈🌟💪]/gu) || []).length;
    return n >= 2 ? ["emoji garnish (" + n + ")", n >= 4 ? 2 : 1] : null;
  },
];

if (typeof module !== "undefined") module.exports = { DESLOP_HEURISTICS, deslopSentences };

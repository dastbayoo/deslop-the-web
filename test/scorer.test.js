// Run: node test/scorer.test.js
const fs = require("fs");
const path = require("path");
const { DESLOP_HEURISTICS } = require("../heuristics.js");
const { deslopParseList, deslopParseCustom, deslopCompile, deslopScore } = require("../scorer.js");

// The shipped list must parse without a single skipped line.
const list = deslopParseList(fs.readFileSync(path.join(__dirname, "..", "lists", "slop-list.txt"), "utf8"));
if (list.errors.length) throw new Error("slop-list.txt has errors:\n" + list.errors.join("\n"));
const DESLOP_PATTERNS = list.patterns;
const DESLOP_SNIPS = list.snips;
console.log(`list: ${DESLOP_PATTERNS.length} patterns, ${DESLOP_SNIPS.length} snips`);

for (const [bad, why] of [["<!doctype html><html>", "HTML page"], ["", "empty"]]) {
  let threw = false;
  try { deslopParseList(bad); } catch (e) { threw = true; }
  if (!threw) throw new Error(`deslopParseList accepted ${why}`);
}

const compiled = deslopCompile(DESLOP_PATTERNS);
if (compiled.length !== DESLOP_PATTERNS.length) throw new Error("some patterns failed to compile");
const THRESHOLD = 3;

const slop = [
  "In today's fast-paced digital landscape, businesses must continually adapt to stay ahead of the curve. Let's dive in and explore how you can unlock the full potential of your marketing strategy.",
  "Nestled in the heart of Tuscany, this charming village is a testament to centuries of rich history. Its bustling markets and vibrant culture weave a rich tapestry that captivates every visitor who wanders its streets.",
  "It's important to note that effective communication plays a crucial role in any successful team. By fostering a sense of collaboration, leaders can empower individuals to reach their goals and drive meaningful results.",
  "Whether you're a seasoned developer or just starting out, this comprehensive guide will help you navigate the complexities of modern web development with confidence and ease.",
  "AI isn't just a tool — it's a paradigm shift in how we work. The result? Teams that move faster, think bigger, and deliver more value than ever before. Let that sink in.",
  "In this article, we will delve into the intricacies of quantum computing and shed light on why it is poised to transform industries ranging from finance to healthcare and beyond.",
  "Embarking on a journey of self-discovery is never easy, but it is a beautiful path that ultimately leads to growth, resilience, and a deeper understanding of who we truly are.",
];

const human = [
  "The bridge was closed on Tuesday after inspectors found cracks in two of its support columns. City officials said repairs could take up to six weeks, and traffic will be diverted through the Elm Street underpass in the meantime.",
  "I tried three different brands of cast iron pans over the past year. The cheapest one rusted after a month because I left it wet overnight, which was entirely my fault, but the enamel one chipped too, which was not.",
  "Photosynthesis converts light energy into chemical energy stored in glucose. In plants, it takes place mainly in the chloroplasts of leaf cells, which contain the pigment chlorophyll that absorbs red and blue wavelengths.",
  "The function returns null when the cache is empty, so callers need to handle that case. We considered throwing instead, but most call sites already check for null and changing that would have touched forty files.",
  "Our landlord finally fixed the heating last week. It had been broken since October, and we spent most evenings wrapped in blankets watching old films, which honestly was not the worst way to spend a winter.",
  "The team played a robust defensive game in the first half, but conceded twice after the break when their captain went off injured. The coach said afterwards that the squad needs to navigate a difficult run of fixtures.",
];

let fail = 0;
const show = (kind, t, r, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} [${kind}] score ${r.score}/${r.threshold}  ${t.slice(0, 60)}…`);
  if (!ok || process.argv.includes("-v")) console.log("      ", r.hits.map((h) => `${h.label}(+${h.weight})`).join(", "));
};
for (const t of slop) {
  const r = deslopScore(t, compiled, DESLOP_HEURISTICS, THRESHOLD);
  const ok = r.score >= r.threshold; if (!ok) fail++; show("slop ", t, r, ok);
}
for (const t of human) {
  const r = deslopScore(t, compiled, DESLOP_HEURISTICS, THRESHOLD);
  const ok = r.score < r.threshold; if (!ok) fail++; show("human", t, r, ok);
}

// Inline snips: [text, expected snipped fragments (all scopes)]
const snipRules = DESLOP_SNIPS.map(([label, s]) => ({ label, re: new RegExp(s, "giu") }));
const snipCases = [
  ["Every open question is one grep away, always:", [", always"]],
  ["A record, verbatim", [", verbatim"]],
  ["one question from the record, exactly as it sits in the repository:", [", exactly as it sits in the repository"]],
  ["It's where conversations become decisions — deliberative programming, in one habit.", [", in one habit"]],
  ["Built by a crew of named collaborators — which is the whole point.", [" — which is the whole point"]],
  ["We ship weekly. Full stop. Then we rest.", ["Full stop. "]],
  ["Honestly, the tooling quietly compounds.", ["Honestly, ", "quietly "]],
  // must stay untouched
  ["He always said it verbatim to the press.", []],
  ["As always, the trains were late.", []],
  ["The verbatim transcript was published on Monday.", []],
];
for (const [text, want] of snipCases) {
  const got = [];
  for (const { re } of snipRules) for (const m of text.matchAll(re)) got.push(m[0]);
  const ok = JSON.stringify(got.sort()) === JSON.stringify([...want].sort());
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} snip ${JSON.stringify(got)}  ${text}`);
}

// Custom phrase parsing
const custom = deslopParseCustom(["# c", "thought leader | 2", String.raw`/\bunleash\b/ | 4`, "don't sleep on"].join("\n"));
const cc = deslopCompile(custom);
const r = deslopScore("A true thought leader will unleash value. Don’t sleep on it.", cc, [], 3);
const okCustom = custom.length === 3 && r.score === 9;
if (!okCustom) fail++;
console.log(`${okCustom ? "ok  " : "FAIL"} custom phrases score ${r.score} (expected 9)`);

console.log(fail ? `\n${fail} failure(s)` : "\nall passed");
process.exit(fail ? 1 : 0);

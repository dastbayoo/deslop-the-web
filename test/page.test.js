// Runs the real content script on saved pages and checks the verdicts.
// Run: node test/page.test.js
const path = require("path");
const fs = require("fs");
const { runPage } = require("./harness.js");

const FIX = path.join(__dirname, "fixtures");

(async () => {
  let fail = 0;
  const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fail++; };

  // Known slop: paragraphs collapse and the whole page gets the banner.
  {
    const { window, state } = await runPage(path.join(FIX, "adrs.systems.html"));
    const banner = window.document.querySelector("[data-deslop-banner]");
    check(state.count >= 5, `adrs.systems: ${state.count} paragraphs collapsed (want >= 5)`);
    check(state.page.slop && !!banner, `adrs.systems: page flagged, banner shown (density ${state.page.density})`);
    const snipped = [...window.document.querySelectorAll("deslop-snip")].map((s) => s.textContent.replace(/\s+/g, " "));
    for (const want of [", verbatim", ", always", ", exactly as it sits in the repository"]) {
      check(snipped.includes(want), `adrs.systems: snipped "${want}"`);
    }
    const h2 = [...window.document.querySelectorAll("h2")].find((h) => h.textContent.startsWith("A record"));
    check(h2 && h2.querySelector("deslop-snip"), "adrs.systems: heading 'A record, verbatim' snipped");
  }

  // Human writing: nothing collapses, no banner.
  for (const f of fs.readdirSync(FIX).filter((f) => f.startsWith("human-"))) {
    const { window, state } = await runPage(path.join(FIX, f));
    const banner = window.document.querySelector("[data-deslop-banner]");
    const density = state.page ? state.page.density : "n/a";
    check(state.count === 0 && !banner && state.snips === 0,
      `${f}: ${state.count} collapsed, ${state.snips} snips, banner ${!!banner} (density ${density})`);
  }

  console.log(fail ? `\n${fail} failure(s)` : "\nall passed");
  process.exit(fail ? 1 : 0);
})();

// Runs the real content script against a saved HTML page in jsdom.
// Usage: node test/harness.js test/fixtures/page.html [-v]
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

const LIST_TEXT = fs.readFileSync(path.join(ROOT, "lists", "slop-list.txt"), "utf8");

async function runPage(file, storage = {}) {
  storage = { listCache: { text: LIST_TEXT, source: "bundled" }, ...storage };
  const html = fs.readFileSync(file, "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.test/" });
  const { window } = dom;
  const sent = [];
  window.browser = {
    storage: {
      local: { get: async (defaults) => ({ ...defaults, ...storage }) },
      onChanged: { addListener() {} },
    },
    runtime: {
      sendMessage: async (m) => { sent.push(m); },
      onMessage: { addListener(fn) { window.__deslopMsg = fn; } },
    },
  };
  // One eval so top-level consts are shared, like content scripts sharing a sandbox.
  const src = ["heuristics.js", "scorer.js", "content.js"]
    .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
  window.eval(src);
  await new Promise((r) => setTimeout(r, 50));
  const state = await window.__deslopMsg({ type: "getState" });
  return { window, state, sent, debug: window.__deslopDebug };
}

module.exports = { runPage };

if (require.main === module) {
  (async () => {
    const { window, state } = await runPage(process.argv[2], { debug: true });
    const doc = window.document;
    const banner = doc.querySelector("[data-deslop-banner]");
    console.log("collapsed paragraphs:", state.count, "| page verdict:", JSON.stringify(state.page));
    console.log("banner shown:", !!banner);
    const snips = [...doc.querySelectorAll("deslop-snip")];
    console.log(`snips: ${snips.length}`);
    for (const s of snips) {
      const ctx = (s.parentElement.textContent || "").replace(/\s+/g, " ");
      const at = ctx.indexOf(s.textContent);
      console.log(`  ✂ [${s.getAttribute("data-label")}] "${s.textContent}"  …${ctx.slice(Math.max(0, at - 40), at)}⟦${s.textContent}⟧${ctx.slice(at + s.textContent.length, at + s.textContent.length + 20)}…`);
    }
    if (process.argv.includes("-v")) {
      for (const d of window.__deslopDebug || []) {
        const flag = d.collapsed ? "COLLAPSE" : d.skipped ? "skip    " : "keep    ";
        console.log(`${flag} ${String(d.score).padStart(3)}/${d.threshold} ${String(d.words).padStart(3)}w ${d.text.slice(0, 70)}`);
        if (d.hits && d.hits.length) console.log("          ", d.hits.map((h) => `${h.label}(+${h.weight}${h.count > 1 ? "x" + h.count : ""})`).join(", "));
      }
    }
  })();
}

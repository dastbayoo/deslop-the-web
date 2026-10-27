// Deslop content script: finds text paragraphs, scores them, collapses slop.
/* global DESLOP_HEURISTICS, deslopParseList, deslopParseCustom, deslopCompile, deslopScore */

(() => {
  const DEFAULTS = {
    enabled: true,
    threshold: 3,          // base score needed to collapse a paragraph
    minWords: 15,          // ignore paragraphs shorter than this
    minPageWords: 250,     // only act on pages with "larger areas of text"
    pageBanner: true,      // whole-page verdict with a banner on top
    pageDensity: 3,        // slop points per 100 words that mark the whole page
    pageRatio: 0.25,       // ...or this share of paragraphs collapsed (min. 3)
    inlineSnips: true,     // cut filler fragments (", always") into ✂ buttons
    disabledSites: [],
    customPhrases: "",
    customSnips: "",
  };

  // Text-bearing blocks. Only leaves (blocks without nested blocks) are scored,
  // so an <li> wrapping <p>s is handled through its <p>s.
  const BLOCK_SEL = "p, pre, li, blockquote, dd, dt, figcaption, div, section, article, aside, main";
  const SKIP_SEL = "pre, code, kbd, samp, textarea, input, select, nav, script, style, noscript, svg, " +
                   "cite, .references, .reflist, " +
                   "[contenteditable=''], [contenteditable='true'], deslop-notice, [data-deslop-wrap]";
  const HIDDEN_ATTR = "data-deslop-hidden";
  const HEADING_SEL = "h1, h2, h3, h4, h5, h6";
  const SUSPICIOUS_DENSITY = 1;   // slop points / 100 words; human pages score ~0.1–0.2
  const SNIP_SKIP_SEL = "pre, code, kbd, samp, textarea, script, style, deslop-snip";

  let settings = { ...DEFAULTS };
  let compiled = [];
  let active = false;
  let entries = [];               // { el, wrap, notice, result, expanded }
  let seen = new WeakMap();       // el -> textContent length at last check
  let results = new Map();        // el -> score result, for the page verdict
  let page = null;                // latest page verdict
  let banner = null;              // { host, root, dismissed }
  let snipRules = [];             // { label, re, scope }
  let snips = [];                 // <deslop-snip> hosts
  let snipLevel = new WeakMap();  // el -> 1 ("always" rules applied) or 2 (+ "sloppy")
  let lastSentCount = -1;
  let observer = null;
  let scanTimer = null;

  const hostname = location.hostname;

  // --- Settings ------------------------------------------------------------

  async function loadSettings() {
    settings = { ...DEFAULTS, ...(await browser.storage.local.get(DEFAULTS)) };
    // The background script keeps listCache filled (shared URL → cache → bundled).
    let { listCache } = await browser.storage.local.get("listCache");
    if (!listCache) listCache = await browser.runtime.sendMessage({ type: "getList" }).catch(() => null);
    let list = { patterns: [], snips: [] };
    try {
      list = deslopParseList(listCache && listCache.text);
    } catch (e) {
      console.warn("[deslop] no usable slop list:", e.message);
    }
    compiled = deslopCompile(list.patterns.concat(deslopParseCustom(settings.customPhrases)));
    // Custom snips reuse the custom phrase syntax; the weight column is ignored.
    const customSnips = deslopParseCustom(settings.customSnips).map(([l, s]) => [l, s, "always"]);
    snipRules = [];
    for (const [label, source, scope] of list.snips.concat(customSnips)) {
      try {
        snipRules.push({ label, re: new RegExp(source, "giu"), scope });
      } catch (e) {
        console.warn("[deslop] bad snip skipped:", label, e.message);
      }
    }
    active = settings.enabled && !settings.disabledSites.includes(hostname);
  }

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    // Refresh bookkeeping only; rescanning would re-collapse what the user opened.
    if (Object.keys(changes).every((k) => k === "listStatus" || k === "listUrl")) return;
    restoreAll();
    await loadSettings();
    if (active) scan(); else reportCount();
  });

  // --- Scanning ------------------------------------------------------------

  function textOf(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function leafBlocks() {
    const out = [];
    for (const el of document.body.querySelectorAll(BLOCK_SEL)) {
      if (el.hasAttribute(HIDDEN_ATTR)) continue;
      if (el.querySelector(BLOCK_SEL)) continue;
      if (el.closest(SKIP_SEL)) continue;
      out.push(el);
    }
    return out;
  }

  function scan() {
    if (!active || !document.body) return;
    entries = entries.filter((e) => e.el.isConnected || (e.wrap.remove(), false));

    const blocks = leafBlocks();
    const texts = blocks.map(textOf);
    const pageWords = texts.reduce((n, t) => n + (t.match(/\S+/g) || []).length, 0);
    if (pageWords < settings.minPageWords) return reportCount();

    // Test hook: the jsdom harness sets `debug` to get a per-block report.
    const debug = settings.debug ? (window.__deslopDebug = window.__deslopDebug || []) : null;
    blocks.forEach((el, i) => {
      const text = texts[i];
      if (seen.get(el) === text.length) return;
      seen.set(el, text.length);
      const words = (text.match(/\S+/g) || []).length;
      if (words < settings.minWords) {
        if (debug && words) debug.push({ text, words, score: "-", threshold: "-", skipped: true });
        return;
      }
      const result = deslopScore(text, compiled, DESLOP_HEURISTICS, settings.threshold);
      const collapsed = result.score >= result.threshold;
      results.set(el, { ...result, collapsed });
      if (debug) debug.push({ text, ...result, collapsed });
      if (collapsed) collapse(el, result);
    });
    updatePage();
    if (settings.inlineSnips) applySnips(blocks);
    reportCount();
  }

  // --- Inline snips ----------------------------------------------------------

  function applySnips(blocks) {
    // Collapsed paragraphs are snipped too, so "Show anyway" reveals them trimmed.
    const targets = [...new Set([...blocks, ...results.keys()])];
    for (const h of document.body.querySelectorAll(HEADING_SEL)) if (!h.closest(SKIP_SEL)) targets.push(h);
    for (const el of targets) {
      // Single-word snips only where slop is established: in a collapsed
      // paragraph, or on a page that is at least suspicious as a whole.
      // (Austen says "remarkably agreeable" and means it.)
      const r = results.get(el);
      const level = (r && r.collapsed) || (page && page.density >= SUSPICIOUS_DENSITY) ? 2 : 1;
      if ((snipLevel.get(el) || 0) >= level) continue;
      snipLevel.set(el, level);
      snipElement(el, level === 2);
    }
  }

  function snipElement(el, sloppy) {
    const rules = snipRules.filter((r) => sloppy || r.scope === "always");
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest(SNIP_SKIP_SEL)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const text = node.nodeValue;
      if (!text.trim()) continue;
      const found = [];
      for (const { label, re } of rules) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
          if (m[0].trim()) found.push({ start: m.index, end: m.index + m[0].length, label });
        }
      }
      if (!found.length) continue;
      found.sort((a, b) => a.start - b.start || b.end - a.end);
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const f of found) {
        if (f.start < pos) continue; // overlaps an earlier, longer snip
        if (f.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, f.start)));
        frag.appendChild(makeSnip(text.slice(f.start, f.end), f.label));
        pos = f.end;
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      node.replaceWith(frag);
    }
  }

  const SNIP_CSS = `
    :host { display: inline; }
    slot { display: none; }
    :host([data-open]) slot { display: inline; background: rgba(255, 216, 77, .35); text-decoration: line-through; text-decoration-color: rgba(176, 0, 32, .6); }
    button {
      all: unset; cursor: pointer; font: 600 0.7em/1.3 system-ui, sans-serif; padding: 0 .35em; margin: 0 .15em;
      border-radius: .7em; background: #ffe58a; color: #3b2f00; border: 1px solid #d4a017; vertical-align: .15em;
    }
    button:hover { background: #ffd84d; }
    @media (prefers-color-scheme: dark) { button { background: #6b5717; color: #fff3c4; border-color: #a88a2a; } }
  `;

  function makeSnip(text, label) {
    const host = document.createElement("deslop-snip");
    host.setAttribute("data-deslop-wrap", "");
    host.setAttribute("data-label", label);
    host.textContent = text;
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${SNIP_CSS}</style><button type="button"></button><slot></slot>`;
    const btn = root.querySelector("button");
    btn.textContent = "✂";
    btn.title = `Slop snipped (${label}): “${text.trim()}” — click to show`;
    btn.addEventListener("click", (e) => {
      // Snips can sit inside links; don't follow them.
      e.preventDefault();
      e.stopPropagation();
      host.toggleAttribute("data-open");
    });
    snips.push(host);
    return host;
  }

  function removeSnips() {
    for (const host of snips) {
      if (!host.isConnected) continue;
      const parent = host.parentNode;
      host.replaceWith(document.createTextNode(host.textContent));
      parent.normalize();
    }
    snips = [];
    snipLevel = new WeakMap();
  }

  // --- Whole-page verdict --------------------------------------------------
  // Slop spread thinly (one dash and one tic per paragraph) never trips the
  // per-paragraph threshold, so the page is also judged as a whole.

  function updatePage() {
    for (const el of results.keys()) if (!el.isConnected) results.delete(el);
    let words = 0, score = 0, collapsed = 0;
    const labels = new Map();
    for (const r of results.values()) {
      words += r.words;
      score += r.score;
      if (r.collapsed) collapsed++;
      for (const h of r.hits) {
        const key = h.label.replace(/ \(\d+\)$/, "");
        labels.set(key, (labels.get(key) || 0) + h.count);
      }
    }
    const scored = results.size;
    const density = words ? (score / words) * 100 : 0;
    const ratio = scored ? collapsed / scored : 0;
    const slop = words >= settings.minPageWords &&
      (density >= settings.pageDensity || (collapsed >= 3 && ratio >= settings.pageRatio));
    const top = [...labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    page = { slop, density: Math.round(density * 10) / 10, collapsed, scored, words, top };
    if (settings.pageBanner && slop) showBanner();
    else if (banner) { banner.host.remove(); banner = null; }
  }

  const BANNER_CSS = `
    :host { all: initial; display: block; position: relative; z-index: 2147483646; }
    .bar {
      font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      background: repeating-linear-gradient(-45deg, #ffd84d 0 18px, #ffe58a 18px 36px);
      color: #2b2200; border-bottom: 3px solid #b8860b; padding: 14px 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,.25);
    }
    .inner { max-width: 960px; margin: 0 auto; background: rgba(255,248,219,.92); border-radius: 8px; padding: 12px 16px; }
    h2 { font-size: 22px; margin: 0 0 4px; }
    p { margin: 4px 0; }
    .top { font-size: 13px; opacity: .85; }
    .row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    button {
      font: inherit; font-size: 14px; cursor: pointer; border-radius: 5px; padding: 4px 12px;
      border: 1px solid #8a6a10; background: #fff3c4; color: #2b2200;
    }
    button:hover { background: #ffe58a; }
    @media (prefers-color-scheme: dark) {
      .bar { background: repeating-linear-gradient(-45deg, #5a4810 0 18px, #3a3214 18px 36px); color: #fff3c4; border-bottom-color: #d4a017; }
      .inner { background: rgba(30,26,10,.92); }
      button { background: #6b5717; border-color: #a88a2a; color: #fff3c4; }
    }
  `;

  function showBanner() {
    if (!banner) {
      const host = document.createElement("deslop-banner");
      host.setAttribute("data-deslop-wrap", "");
      host.setAttribute("data-deslop-banner", "");
      banner = { host, root: host.attachShadow({ mode: "closed" }), dismissed: false };
    }
    if (banner.dismissed) return;
    if (!banner.host.isConnected) document.body.prepend(banner.host);
    const top = page.top.map(([l, n]) => escapeHtml(l) + (n > 1 ? ` ×${n}` : "")).join(" · ");
    banner.root.innerHTML = `<style>${BANNER_CSS}</style>
      <div class="bar"><div class="inner">
        <h2>⚠️ Trigger warning: this whole page reads like AI slop</h2>
        <p>${page.collapsed} of ${page.scored} paragraphs collapsed ·
          ${page.density} slop points per 100 words (page limit ${settings.pageDensity}).
          Continue at your own risk of second-hand embarrassment.</p>
        <p class="top">Most frequent: ${top}</p>
        <div class="row">
          <button type="button" data-act="show">Show all paragraphs</button>
          <button type="button" data-act="dismiss">Dismiss</button>
        </div>
      </div></div>`;
    banner.root.querySelector("[data-act=show]").onclick = () => entries.forEach((e) => setExpanded(e, true));
    banner.root.querySelector("[data-act=dismiss]").onclick = () => {
      banner.dismissed = true;
      banner.host.remove();
    };
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 600);
  }

  // --- Collapse UI ---------------------------------------------------------

  const NOTICE_CSS = `
    :host { display: block; all: initial; display: block; margin: 0.6em 0; }
    .box {
      font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #3b2f00; background: #fff8db; border: 1px solid #e8c547;
      border-left: 4px solid #d4a017; border-radius: 6px; padding: 10px 12px;
    }
    .box.shown { padding: 4px 10px; background: #f6f6f6; border-color: #ccc; border-left-color: #999; color: #555; font-size: 12px; }
    .head { font-weight: 700; margin-bottom: 4px; }
    .body { margin-bottom: 6px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    button {
      font: inherit; cursor: pointer; border-radius: 4px; padding: 3px 10px;
      border: 1px solid #b8901a; background: #ffe58a; color: #3b2f00;
    }
    button:hover { background: #ffd84d; }
    .shown button { padding: 1px 8px; border-color: #aaa; background: #eee; color: #333; }
    details { font-size: 12px; opacity: 0.85; }
    summary { cursor: pointer; }
    ul { margin: 4px 0 0 18px; padding: 0; }
    @media (prefers-color-scheme: dark) {
      .box { color: #f5e6a8; background: #3a3214; border-color: #8a7224; border-left-color: #d4a017; }
      .box.shown { background: #2a2a2a; border-color: #555; border-left-color: #777; color: #bbb; }
      button { background: #6b5717; border-color: #a88a2a; color: #fff3c4; }
      button:hover { background: #806a1e; }
      .shown button { background: #3a3a3a; border-color: #666; color: #ddd; }
    }
  `;

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function collapse(el, result) {
    // Keep list/definition markup valid: the wrapper takes the same tag.
    const tag = el.tagName;
    const wrap = ["LI", "DD", "DT"].includes(tag) ? document.createElement(tag) : document.createElement("div");
    wrap.setAttribute("data-deslop-wrap", "");
    if (tag === "LI") wrap.style.listStyle = "none";
    const notice = document.createElement("deslop-notice");
    wrap.appendChild(notice);
    const root = notice.attachShadow({ mode: "closed" });

    const entry = { el, wrap, root, result, expanded: false };
    render(entry);
    el.parentNode.insertBefore(wrap, el);
    el.setAttribute(HIDDEN_ATTR, "");
    entries.push(entry);
  }

  function render(entry) {
    const { root, result } = entry;
    const n = result.hits.length;
    const list = result.hits
      .map((h) => `<li>${escapeHtml(h.label)}${h.count > 1 ? ` ×${h.count}` : ""} <span style="opacity:.6">(+${h.weight})</span></li>`)
      .join("");
    if (entry.expanded) {
      root.innerHTML = `<style>${NOTICE_CSS}</style>
        <div class="box shown"><div class="row">
          <span>⚠️ Slop below (score ${result.score}, ${n} pattern${n === 1 ? "" : "s"})</span>
          <button type="button">Collapse again</button>
        </div></div>`;
    } else {
      root.innerHTML = `<style>${NOTICE_CSS}</style>
        <div class="box">
          <div class="head">⚠️ Trigger warning: AI slop</div>
          <div class="body">A paragraph (${result.words} words) was collapsed because it matched
            ${n} known slop pattern${n === 1 ? "" : "s"} (score ${result.score}, threshold ${result.threshold}).
            Reading it may cause eye-rolling, second-hand embarrassment, or an urge to delve.</div>
          <div class="row">
            <button type="button">Show anyway</button>
            <details><summary>What matched?</summary><ul>${list}</ul></details>
          </div>
        </div>`;
    }
    root.querySelector("button").addEventListener("click", () => setExpanded(entry, !entry.expanded));
  }

  function setExpanded(entry, expanded) {
    entry.expanded = expanded;
    if (expanded) entry.el.removeAttribute(HIDDEN_ATTR);
    else entry.el.setAttribute(HIDDEN_ATTR, "");
    render(entry);
  }

  function restoreAll() {
    for (const e of entries) {
      e.el.removeAttribute(HIDDEN_ATTR);
      e.wrap.remove();
    }
    entries = [];
    seen = new WeakMap();
    results = new Map();
    page = null;
    if (banner) banner.host.remove();
    banner = null;
    removeSnips();
  }

  function reportCount() {
    const count = entries.length;
    if (count === lastSentCount) return;
    lastSentCount = count;
    browser.runtime.sendMessage({ type: "count", count }).catch(() => {});
  }

  // --- Popup messaging -----------------------------------------------------

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "getState") {
      return Promise.resolve({
        hostname,
        count: entries.length,
        expanded: entries.filter((e) => e.expanded).length,
        active,
        page,
        snips: snips.filter((s) => s.isConnected).length,
      });
    }
    if (msg.type === "expandAll" || msg.type === "collapseAll") {
      for (const e of entries) setExpanded(e, msg.type === "expandAll");
      return Promise.resolve(true);
    }
  });

  // --- Boot ----------------------------------------------------------------

  (async () => {
    await loadSettings();
    if (active) scan();
    observer = new MutationObserver((mutations) => {
      if (!active) return;
      // Ignore churn caused by our own notices.
      const isOurs = (n) => n.nodeType === 1 && n.hasAttribute("data-deslop-wrap");
      const relevant = mutations.some((m) => {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!t || t.closest("[data-deslop-wrap]")) return false;
        if (m.type === "childList") {
          const nodes = [...m.addedNodes, ...m.removedNodes];
          if (nodes.length && nodes.every(isOurs)) return false;
        }
        return true;
      });
      if (relevant) scheduleScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  })();
})();

/* global deslopParseList */
const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  customPhrases: "", minWords: 15, minPageWords: 250, disabledSites: [],
  pageBanner: true, pageDensity: 3, pageRatio: 0.25,
  inlineSnips: true, customSnips: "",
};
// Hosts the manifest already grants; anything else is requested on save.
const GRANTED_HOSTS = ["raw.githubusercontent.com", "gist.githubusercontent.com"];

const fmtTime = (t) => (t ? new Date(t).toLocaleString() : "never");

async function renderList() {
  const { listCache, listStatus } = await browser.storage.local.get(["listCache", "listStatus"]);
  let counts = "no list loaded";
  let parsed = null;
  try {
    parsed = deslopParseList(listCache && listCache.text);
    counts = `${parsed.patterns.length} patterns, ${parsed.snips.length} snips`;
  } catch (e) { /* shown as "no list loaded" */ }

  const source = !listCache ? "—"
    : listCache.source === "remote" ? `shared list, downloaded ${fmtTime(listCache.fetchedAt)}`
    : "copy bundled with the extension";
  let html = `Using: <b>${source}</b> · ${counts}`;
  if (listStatus) {
    html += `<br>Last check: ${fmtTime(listStatus.checkedAt)} — ` +
      (listStatus.ok && !listStatus.error ? "ok"
        : `<span style="color:#c0392b">${listStatus.error.replace(/</g, "&lt;")}</span>` +
          (listStatus.ok ? "" : " (kept the previous copy)"));
  }
  $("listStatus").innerHTML = html;

  if (parsed) {
    $("builtinCount").textContent = counts;
    $("builtin").textContent =
      parsed.patterns.map(([label, , w]) => `+${w}  ${label}`).join("\n") +
      "\n\nsnips:\n" + parsed.snips.map(([label, , scope]) => `✂ ${label}  (${scope})`).join("\n");
  }
}

(async () => {
  const defaultUrl = await browser.runtime.sendMessage({ type: "defaultListUrl" });
  const s = await browser.storage.local.get({ ...DEFAULTS, listUrl: defaultUrl });
  $("listUrl").value = s.listUrl;
  $("listUrl").placeholder = "empty = bundled copy only";
  $("customPhrases").value = s.customPhrases;
  $("minWords").value = s.minWords;
  $("minPageWords").value = s.minPageWords;
  $("pageBanner").checked = s.pageBanner;
  $("pageDensity").value = s.pageDensity;
  $("pageRatio").value = Math.round(s.pageRatio * 100);
  $("inlineSnips").checked = s.inlineSnips;
  $("customSnips").value = s.customSnips;
  $("disabledSites").value = s.disabledSites.join("\n");
  renderList();
  browser.storage.onChanged.addListener((c) => { if (c.listCache || c.listStatus) renderList(); });

  $("resetUrl").onclick = () => { $("listUrl").value = defaultUrl; };
  $("refresh").onclick = async () => {
    $("listStatus").textContent = "Updating…";
    await browser.runtime.sendMessage({ type: "refreshList" });
    renderList();
  };

  $("save").onclick = async () => {
    const listUrl = $("listUrl").value.trim();
    // permissions.request() must run directly in the click handler, before any await.
    let granted = Promise.resolve(true);
    if (listUrl) {
      let url = null;
      try { url = new URL(listUrl); } catch (e) { /* reported below */ }
      if (!url || url.protocol !== "https:") {
        $("saved").textContent = "The list URL must start with https://";
        return;
      }
      if (!GRANTED_HOSTS.includes(url.hostname)) {
        granted = browser.permissions.request({ origins: [`https://${url.hostname}/*`] });
      }
    }
    if (!(await granted)) {
      $("saved").textContent = "Permission for that host was declined; list URL not saved.";
      return;
    }
    await browser.storage.local.set({
      listUrl,
      customPhrases: $("customPhrases").value,
      minWords: Math.max(1, Number($("minWords").value) || DEFAULTS.minWords),
      minPageWords: Math.max(0, Number($("minPageWords").value) || 0),
      pageBanner: $("pageBanner").checked,
      inlineSnips: $("inlineSnips").checked,
      customSnips: $("customSnips").value,
      pageDensity: Math.max(0.5, Number($("pageDensity").value) || DEFAULTS.pageDensity),
      pageRatio: Math.min(1, Math.max(0.05, (Number($("pageRatio").value) || 25) / 100)),
      disabledSites: $("disabledSites").value.split(/\s+/).map((x) => x.trim()).filter(Boolean),
    });
    $("saved").textContent = "Saved ✓";
    setTimeout(() => ($("saved").textContent = ""), 1500);
  };
})();

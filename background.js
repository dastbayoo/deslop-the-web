/* global deslopParseList */
// Owns the slop list and the toolbar badge.
//
// List sources, in order: the shared list URL (the GitHub repo), then the last
// good copy cached in storage, then the copy bundled inside the extension.
// Content scripts only read `listCache` from storage, so every tab sees the
// same list, and a failed or garbled download never replaces a working one.

const DEFAULT_LIST_URL = "https://raw.githubusercontent.com/dastbayoo/deslop-the-web/main/lists/slop-list.txt";
const BUNDLED_LIST = browser.runtime.getURL("lists/slop-list.txt");
const MIN_PATTERNS = 20;           // a "list" with fewer entries is treated as broken
const REFRESH_MINUTES = 6 * 60;

async function readBundled() {
  const text = await (await fetch(BUNDLED_LIST)).text();
  return { text, source: "bundled", url: null, fetchedAt: Date.now() };
}

function validate(text) {
  const parsed = deslopParseList(text); // throws if it isn't a list at all
  if (parsed.patterns.length < MIN_PATTERNS) {
    throw new Error(`only ${parsed.patterns.length} valid patterns (need ${MIN_PATTERNS})`);
  }
  return parsed;
}

async function ensureCache() {
  const { listCache } = await browser.storage.local.get("listCache");
  if (listCache && listCache.text) return listCache;
  const bundled = await readBundled();
  await browser.storage.local.set({ listCache: bundled });
  return bundled;
}

// Only writes listCache when the text actually changes, so tabs don't rescan
// (and re-collapse paragraphs the user opened) on every no-op refresh.
async function setCache(next) {
  const { listCache } = await browser.storage.local.get("listCache");
  if (!listCache || listCache.text !== next.text || listCache.source !== next.source) {
    await browser.storage.local.set({ listCache: next });
  }
}

async function refreshList() {
  const { listUrl } = await browser.storage.local.get({ listUrl: DEFAULT_LIST_URL });
  const status = { checkedAt: Date.now(), url: listUrl || null, ok: false, error: null };
  try {
    if (!listUrl) {
      await setCache(await readBundled());
      status.ok = true;
    } else {
      const res = await fetch(listUrl, { cache: "no-cache", credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = validate(text);
      await setCache({ text, source: "remote", url: listUrl, fetchedAt: Date.now() });
      status.ok = true;
      if (parsed.errors.length) status.error = `${parsed.errors.length} line(s) skipped: ${parsed.errors[0]}`;
    }
  } catch (e) {
    status.error = String(e.message || e);
    await ensureCache(); // keep the previous copy, or fall back to the bundled one
  }
  await browser.storage.local.set({ listStatus: status });
  return status;
}

browser.alarms.create("refresh-list", { periodInMinutes: REFRESH_MINUTES });
browser.alarms.onAlarm.addListener((a) => { if (a.name === "refresh-list") refreshList(); });
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.listUrl) refreshList();
});
ensureCache().then(refreshList);

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "getList") return ensureCache();
  if (msg.type === "refreshList") return refreshList();
  if (msg.type === "defaultListUrl") return Promise.resolve(DEFAULT_LIST_URL);
  // Badge: number of collapsed paragraphs, per tab.
  if (msg.type === "count" && sender.tab) {
    const tabId = sender.tab.id;
    browser.browserAction.setBadgeText({ tabId, text: msg.count ? String(msg.count) : "" });
    browser.browserAction.setBadgeBackgroundColor({ tabId, color: "#d4a017" });
  }
});

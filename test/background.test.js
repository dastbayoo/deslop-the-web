// Tests the list fallback chain in background.js with a fake browser + fetch.
// Run: node test/background.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const BUNDLED = fs.readFileSync(path.join(ROOT, "lists", "slop-list.txt"), "utf8");
const REMOTE_URL = "https://raw.githubusercontent.com/x/deslop-the-web/main/lists/slop-list.txt";
// A valid but different list: bundled plus one extra pattern.
const REMOTE_OK = BUNDLED.replace("[patterns]", "[patterns]\n5 | remote-only test pattern | \\bzzremotezz\\b");

function makeEnv(responder, initial = {}) {
  const store = { ...initial };
  const listeners = { message: null };
  const browser = {
    runtime: {
      getURL: (p) => "moz-extension://test/" + p,
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
    },
    storage: {
      local: {
        get: async (keys) => {
          if (typeof keys === "string") return keys in store ? { [keys]: store[keys] } : {};
          if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]));
          return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in store ? store[k] : d]));
        },
        set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
      },
      onChanged: { addListener() {} },
    },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    browserAction: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  };
  const fetch = async (url) => {
    if (url.startsWith("moz-extension://")) return { ok: true, status: 200, text: async () => BUNDLED };
    const r = responder(url);
    if (r instanceof Error) throw r;
    return { ok: r.status === 200, status: r.status, text: async () => r.body };
  };
  const ctx = vm.createContext({ browser, fetch, console, Date, Promise, URL });
  for (const f of ["scorer.js", "background.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
  return { store, send: (msg) => listeners.message(msg, {}) };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  let fail = 0;
  const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fail++; };
  const isRemote = (s) => s.listCache && s.listCache.source === "remote" && s.listCache.text.includes("zzremotezz");

  // 1. Remote reachable → remote list is used
  let env = makeEnv(() => ({ status: 200, body: REMOTE_OK }), { listUrl: REMOTE_URL });
  await settle();
  check(isRemote(env.store) && env.store.listStatus.ok, "remote ok → remote list cached");

  // 2. Remote 404 after a good download → previous remote copy is kept
  const cached = env.store.listCache;
  env = makeEnv(() => ({ status: 404, body: "Not Found" }), { listUrl: REMOTE_URL, listCache: cached });
  await settle();
  check(isRemote(env.store) && /404/.test(env.store.listStatus.error), "remote 404 → keeps previous copy, reports error");

  // 3. Remote returns an HTML login page, no cache yet → bundled copy
  env = makeEnv(() => ({ status: 200, body: "<!doctype html><title>Sign in</title>" }), { listUrl: REMOTE_URL });
  await settle();
  check(env.store.listCache.source === "bundled" && /not a deslop list/.test(env.store.listStatus.error),
    "remote HTML page → rejected, bundled copy used");

  // 4. Remote list truncated to almost nothing → rejected
  env = makeEnv(() => ({ status: 200, body: "## deslop-list v1\n[patterns]\n3 | x | \\bx\\b\n" }), { listUrl: REMOTE_URL, listCache: cached });
  await settle();
  check(isRemote(env.store) && /only 1 valid patterns/.test(env.store.listStatus.error), "truncated remote list → rejected, previous copy kept");

  // 5. Network down, no cache → bundled
  env = makeEnv(() => new Error("NetworkError"), { listUrl: REMOTE_URL });
  await settle();
  check(env.store.listCache.source === "bundled" && !env.store.listStatus.ok, "offline → bundled copy");

  // 6. Empty URL → bundled only, even if a remote copy was cached
  env = makeEnv(() => { throw new Error("must not fetch"); }, { listUrl: "", listCache: cached });
  await settle();
  check(env.store.listCache.source === "bundled" && env.store.listStatus.ok, "empty URL → bundled copy, no fetch");

  // 7. getList message answers from cache
  const got = await env.send({ type: "getList" });
  check(got && got.text === BUNDLED, "getList returns the active list");

  console.log(fail ? `\n${fail} failure(s)` : "\nall passed");
  process.exit(fail ? 1 : 0);
})();

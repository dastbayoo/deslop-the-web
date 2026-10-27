// Downloads the test pages listed in test/fixtures/sources.txt (skips existing ones).
// Run: npm run fixtures   (add --force to re-download)
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "fixtures");
const force = process.argv.includes("--force");

(async () => {
  const lines = fs.readFileSync(path.join(DIR, "sources.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [name, url] = line.trim().split(/\s+/);
    const file = path.join(DIR, name + ".html");
    if (fs.existsSync(file) && !force) { console.log(`have  ${name}`); continue; }
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 deslop-tests" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file, await res.text());
      console.log(`got   ${name}`);
    } catch (e) {
      console.log(`FAIL  ${name}: ${e.message}`);
      process.exitCode = 1;
    }
  }
})();

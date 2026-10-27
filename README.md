# Deslop the Web (Firefox extension)

Collapses paragraphs that read like AI slop and puts a trigger warning in their place, with a
"Show anyway" button. It also cuts filler fragments (", always", ", verbatim") into small ✂ buttons,
and puts a big banner on pages that are slop as a whole. Everything runs locally against a curated
phrase list. No LLM, and no network access except downloading the shared list.

## Install

**Signed build:** install the `.xpi` you were given. Drag it into Firefox, or use
`about:addons` → gear icon → *Install Add-on From File…*.

**From source (development):** open `about:debugging#/runtime/this-firefox`, click
*Load Temporary Add-on…* and pick `manifest.json`. It's removed when Firefox restarts.

## The shared slop list

The list lives in [`lists/slop-list.txt`](lists/slop-list.txt), a plain text file with one pattern
per line:

    [patterns]
    3 | rich tapestry | \btapestr(?:y|ies)\b
    [snips]
    always | , always | ,\s*(?:always|every (?:single )?time)(?=\s*[.:;!?—–)]|\s*$)

The extension loads it in this order:

1. **Shared URL:** `main` of this repo via raw.githubusercontent.com, re-checked every 6 hours,
2. the **last good copy** cached in the browser, if the URL is unreachable or returns garbage,
3. the **bundled copy** shipped inside the extension, before the first download or with an empty URL.

A download is only accepted if it starts with `## deslop-list v1` and has at least 20 valid patterns,
so a broken edit or a login page never replaces a working list. Your own phrases and snips from the
options page always apply on top. Merged changes reach every install within 6 hours. Use
*Options → Update now* to get them immediately.

To change the list, see [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

- **Page gate:** acts only on pages with at least 250 words of paragraph text.
- **Paragraphs:** scores leaf text blocks (`p`, `li`, `blockquote`, leaf `div`s, …) of 15+ words.
  It skips code, nav, inputs, editable areas and reference lists.
- **Scoring:** every pattern has a weight, and a pattern counts at most twice per paragraph.
  Structural heuristics in `heuristics.js` add to the score: dash density, "Not X. Not Y."
  fragments, telegram-style fragments, semicolon cascades, emoji garnish. A paragraph collapses when
  `score ≥ threshold + floor(words/150)`.
  Sensitivity in the popup: Aggressive 2 · Balanced 3 (default) · Lenient 5 · Only blatant 8.
- **Whole page:** when slop points per 100 words reach 3, or 25% of paragraphs (min. 3) collapse,
  a striped warning banner appears at the top. Calibration: adrs.systems scores 9.3, and the
  human-written test pages score 0.1–0.2.
- **Inline snips:** filler fragments are cut in place, headings included: ", always", ", verbatim",
  ", exactly as it sits in the repository", " — which is the whole point", "Full stop.". Single
  words (quietly, genuinely, truly, "Honestly,") are only cut in collapsed paragraphs or on pages
  scoring ≥ 1 point per 100 words.
- Dynamic pages are rescanned through a debounced MutationObserver. The toolbar badge counts
  collapsed paragraphs.

## Options

- **Popup:** on/off, sensitivity, disable per site, show/hide all on the current page.
- **Options page:** shared list URL and status, your own phrases (`phrase`, `phrase | 2`,
  `/regex/ | 4`) and snips, word limits, page-banner limits, disabled sites, and the active list.

## Development

    npm install      # jsdom, dev only
    npm test         # downloads test pages if missing, then runs all tests

- `test/scorer.test.js`: the list parses cleanly, sample slop and human sentences, snip cases.
- `test/background.test.js`: the list fallback chain (remote, 404, HTML page, truncated list, offline, no URL).
- `test/page.test.js`: runs the real content script in jsdom on the pages in
  `test/fixtures/sources.txt`. The slop page must collapse and get the banner; human-written
  pages must stay untouched. These pages are third-party content, so they are downloaded, not
  committed, and a test can drift if a page changes.
- `node test/harness.js some-page.html -v` prints a per-paragraph score breakdown for any saved page.

### Releasing

Bump `"version"` in `manifest.json`, then:

    npx web-ext sign --channel=unlisted --api-key=<JWT issuer> --api-secret=<JWT secret>

API keys: https://addons.mozilla.org/developers/addon/api/key/. The signed `.xpi` lands in
`web-ext-artifacts/`. The add-on ID `deslop-the-web@dast` must never change. List-only changes
need no release.

## Known gaps

- Table-layout sites (text in `<td>` with `<br>`, e.g. paulgraham.com) aren't scanned, because hiding a
  cell would break the layout.
- Only leaf blocks are scored, so text sharing a container with nested blocks is missed.
- A snip only matches within one text node: a fragment split by a link or `<em>` isn't cut.
- Snips replace text nodes. Pages that re-render with React or similar can get confused. If that
  happens, disable the extension on that site.
- It's a phrase list plus rhythm heuristics. Carefully edited AI text gets through, and heavily
  buzzworded human text can trip it.

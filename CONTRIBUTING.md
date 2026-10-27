# Contributing to the slop list

Everyone with the extension loads [`lists/slop-list.txt`](lists/slop-list.txt) from `main`, so a
merged change reaches all installs within 6 hours, with no new release.

## Adding a pattern

1. Find the section that fits (`# --- Openers ---`, `# --- Terse-aphoristic register ---`, …).
2. Add a line `weight | label | regex`:
   - **3 or more:** near-certain slop; one hit collapses a paragraph at default sensitivity.
     Only for phrases a human writer basically never uses ("rich tapestry", "as an AI language model").
   - **2:** strong marker that needs company.
   - **1:** weak marker that is also common in human writing; it only counts in bulk.
3. The regex is raw: write `\b`, not `\\b`. It's case-insensitive. Use `['’]` for apostrophes.
   Don't put ` | ` (space, bar, space) inside a regex; write `a|b`.

## Adding a snip

Snips cut text out of the page in place. The match is exactly the text that disappears, so include
the leading comma or dash, and end with a lookahead for the punctuation that stays:

    always | , always | ,\s*always(?=\s*[.:;!?—–)]|\s*$)

Use `sloppy` instead of `always` for single words that people also use sincerely ("quietly",
"genuinely"). Those are only cut on pages that already look like slop.

## Before you open a PR

    npm install
    npm test

The tests check that the list parses without errors, that the known slop page is still caught, and
that none of the human-written pages (Wikipedia, Pride and Prejudice, Dan Luu, Coding Horror)
collapses a paragraph, gets a snip, or gets the banner. If you add a pattern that sounds like normal
English, check it against human text first. The Austen novel is a good false-positive trap.

To see why a page did or didn't trigger: save its HTML and run

    node test/harness.js page.html -v

# CSV Chaos Tamer

> A Node.js pipeline that turns messy, community-sourced perk tables into clean, validated JSON for [celestial.decaded.dev](https://celestial.decaded.dev).

## Getting started

Clone and install, then run one of the two front-ends:

```bash
git clone https://github.com/Decaded/CSV-Chaos-Tamer.git
cd CSV-Chaos-Tamer
npm install
```

Requires **Node.js 18 or newer** — grab the LTS from [nodejs.org](https://nodejs.org/), which includes `npm`. If you already had a Node install, skip straight to the commands above.

Then run it:

```bash
npm run web    # web panel → http://localhost:3000 (set CSV_TAMER_PORT to override)
npm run run    # CLI dry-run build of sources/; add --write to write NyaDB/
```

Full requirements, CLI flags, and the web-panel walkthrough are below.

## What it is

CSV Chaos Tamer ingests a folder of **differently formatted CSV and Markdown files** and produces a single, consistent set of [`NyaDB`](https://github.com/Decaded/NyaDB) JSON
databases that the Celestial Gambler site can read without bending backwards.

It ships two front-ends over the same pipeline:

- **CLI** (`npm run run`) — one-shot build for contributors and automation.
- **Web panel** (`npm run web`) — a browser-based alternative to hand-editing files: runs the same build, plus a source-metadata table, a keyword filter editor, and a dataset
  inspector.

It works with any similarly-shaped dataset, not just Celestial.

## Why it exists

[celestial.decaded.dev](https://celestial.decaded.dev) is database-driven and aggregates a large number of **community-sourced documents**. Those documents are chaotic by nature:

- Column names vary wildly between files.
- Some datasets bury important metadata in filenames instead of columns.
- Some sources only export cleanly as Markdown, with formatting shifts mid-series.
- Different contributors change format between chapters.

The core contract that defines this project:

> **The sources are served exactly as they are.** CSV Chaos Tamer never edits, deduplicates, or "corrects" the source data. It only **reformats** it — normalizing headers, cleaning
> whitespace, detecting chapters, and validating the result — so the app can consume the data as-is. If a source document contains something questionable, it stays in the output.

**Spotted a problem with the data itself?** If a source document contains a factual error — a wrong cost, a typo, a misleading description — report it to the original author;
correcting the content is their call, not ours. Once the author fixes it, open a PR with the updated file, and the correction gets ingested as an alternative version of that
source.


## Using it

### Requirements

- Node.js 18 or newer (LTS recommended)
- CSV/Markdown inputs encoded in UTF-8
- Git, to submit prepared data

### Quick start (CLI)

1. Drop your files into a subfolder of `sources/` — the folder name (slugified) becomes the source ID:

```text
sources/
└── your-dataset/
    ├── file1.csv
    └── source.md
```

1. Run a **dry run** first — by default the CLI only builds and validates without touching `NyaDB/`:

```bash
npm run run
```

1. When validation reports zero issues, write the databases:

```bash
npm run run --write
```

If validation finds problems, **nothing is written** until they are fixed — invalid data is never submitted. On failure you get a report: the validation issues, self-service hints
for the common causes, and (if it looks like a real bug) a pre-filled GitHub issue link.

Other CLI flags:

```bash
node src/cli.js --root sources/MySource   # build a different root
node src/cli.js --registry /tmp/registry.json   # keep IDs in a scratch registry
node src/cli.js --config /path/to/source-metadata.config.json
node src/cli.js --write                  # write mode (updates NyaDB/; default is a dry run)
```

Platform shortcuts: `run.bat` (Windows) and `run.sh` (macOS/Linux) do the same.

### Runtime checks

```bash
npm test
```

### Web panel

```bash
npm run web
```

For people who prefer clicking over editing files by hand. It runs the **same pipeline** as the CLI:

- **Build** — live console that streams log lines as they happen (info/warn/error), then a metrics summary. Dry-run first to surface validation errors, then write the `NyaDB/`
  datasets.
- **Source metadata** — edit `source-metadata.config.json` in a single table (name, description, source URL, alt source URL/label, per-category URLs), with filtering. The **Add
  source** button collects the required metadata and then unlocks file uploads — everything lands in one folder named after the slugified source ID.
- **Keyword filter** — edit `src/config/keyword-filter.json` as a plain list; the R18 auto-marking reads it on every build.
- **Datasets** — read-only inspection of the generated databases, with search. Datasets are served as-is, so there is no editor.

**Process locking:** only one build can run at a time. While the web panel runs, the CLI refuses to start and vice versa — close the panel (Ctrl+C) or wait for the other build to
finish.

## Contributing

Contributions are welcome, and most of the work is "make the parser cope with one more format without breaking anything else".

### Ground rules

1. **Never alter source data.** The build must keep serving sources verbatim — the originals in `sources/` are the contract.
2. **Add a regression test first.** The suite lives in `test/` and runs with `npm test`. Every parser change should come with a small fixture or test case that would fail on the
   old code.
3. **Invalid data never ships.** A build does not write until validation passes.

### Common contributions

**Add a new source** — just drop CSV/Markdown files into a new folder under `sources/` and run a dry run. If validation flags a missing metadata entry, add one to
`src/config/source-metadata.config.json` (or use the web panel's Add source). Required fields are `description` and `sourceUrl`; `name` is an optional display name. See
`docs/SOURCE_METADATA.md`.

**Teach the parser a new header** — header synonyms live in `csv.headerMap` in `src/config/settings.js`:

```js
cpcost: 'cost',
price: 'cost',
perkname: 'name',
setting: 'source',
```

**Handle a new Markdown layout** — parsing rules live in `src/parsers/md-parser.js`. Add a regression case in `test/md-parser.test.js` before changing behavior.

**Split chapters into their own files** — configure `shared.splitChapters`; to group physical files as selectable versions, configure `shared.sourceVersions` and
`displayName`/`defaultVersion` per group. See `src/config/settings.js`.

**How data must look when it ships** — `docs/SOURCE_METADATA.md` is the data contract and documents how `generatorSources.json` merges with `perks_*.json`. Read it before touching
output logic.

### Reporting bugs

Use the issue template (`.github/ISSUE_TEMPLATE/bug_report.md`). The CLI and web panel can generate a **pre-filled report** for you — on any build failure, the diagnostics block in
the web panel and the terminal output include an "open a pre-filled bug report" link with the failure details, environment, and last console lines. Paste whatever it does not
include.

### Before opening a PR

- `npm test` — full suite green.
- Run a dry-run build (`npm run run`) over the whole `sources/` tree and confirm validation passes.
- If you touched output logic, confirm `NyaDB/` diffs contain only the intended changes.
- Commit the prepared data and the code change separately when both are present.

## License

[MIT License](LICENSE) — free to use, modify, and distribute.

## Support the project

If this tool or [celestial.decaded.dev](https://celestial.decaded.dev) has been useful, consider supporting development: [https://ko-fi.com/decaded](https://ko-fi.com/decaded)

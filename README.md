# CSV Chaos Tamer

A Node.js script that processes differently formatted CSV and Markdown files into clean, normalized JSON. It’s built specifically to prepare data for
[celestial.decaded.dev](https://celestial.decaded.dev), but it can work with any similar dataset structure.

This parser handles inconsistent CSV headers, Markdown formatting quirks, missing fields, and source-specific oddities so the data is ready to be consumed by the main project without manual cleanup.

---

## Why this exists

[celestial.decaded.dev](https://celestial.decaded.dev) is a database-driven project that relies on a large number of community-sourced datasets. The problem is that these datasets
are often messy:

- Column names vary wildly between files.
- Some datasets bury important metadata in filenames instead of proper columns.
- Some source documents are easier to export as Markdown than DOCX, but still contain inconsistent entry formats.
- Formatting can change mid-series due to different contributors.

The CSV Chaos Tamer standardizes this chaos into a consistent JSON format that celestial can read without breaking.

---

## What it does

- Handles multiple CSV and Markdown formats without requiring a separate config for each.
- Normalizes headers so variations like `Price`, `cost`, and `CPCost` are unified under `cost`.
- Parses numbered Markdown entries with common cost/name layouts.
- Detects chapter information from columns, filenames, Markdown category markers, and Markdown headings.
- Splits out specific chapters into their own JSON files if configured, aggregating split rows across all input folders.
- Cleans text by trimming whitespace, fixing newlines, and removing stray characters.
- Adds source metadata to parsed rows for easier debugging.
- Can be extended with new CSV header mappings, Markdown entry formats, or split rules.

---

## How to set it up

1. Place CSV and/or Markdown files into subfolders inside `sheets/`:

```bash
sheets/
└── DatasetName/
    ├── file1.csv
    ├── file2.csv
    └── source.md
```

2. Install dependencies:

```bash
npm install
```

3. Run the parser:

```bash
npm run run
```

4. Collect your cleaned JSON from `data/`.

You can also run the parser directly:

```bash
node index.js
```

Run the regression tests with:

```bash
npm test
```

---

## Customizing

If your CSVs use unique or inconsistent headers, edit the `headerMap`:

```js
cpcost: 'cost',
price: 'cost',
perkname: 'name',
setting: 'source',
```

If you need to split specific chapters into separate files, modify `shared.splitChapters` in `config.js`:

```js
'waifu catalogue': 'waifu',
'lewd': 'companion_(lewd)',
```

Markdown parsing rules live in `md-parser.js`. When a new Markdown export has a weird entry layout, add a small regression case in `test/md-parser.test.js` before changing the parser.

To inspect Markdown parse quality without dumping a huge source file, run:

```bash
node scripts/md-diagnose.js "sheets/DatasetName/source.md"
```

---

## Output format

The script generates one JSON file per input folder, plus any configured split chapter files. Split chapter files are collected globally, so rows from multiple folders are written together instead of overwriting each other.

Example output:

```json
{
  "1": [
    {
      "__source": "file1",
      "__line": 2,
      "id": 1,
      "cost": 200,
      "name": "Example Perk",
      "source": "Example Jump",
      "chapter": "Example Chapter",
      "description": "Cleaned description here."
    }
  ]
}
```

---

## Requirements

- Node.js 16 or newer
- CSV and Markdown files encoded in UTF-8

---

## License

[MIT License](LICENSE) – free to use, modify, and distribute.

---

## Support the project

If this tool or [celestial.decaded.dev](https://celestial.decaded.dev) has been useful to you, consider supporting development:
[https://ko-fi.com/decaded](https://ko-fi.com/decaded)

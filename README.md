# CSV Chaos Tamer

A Node.js script that processes differently formatted CSV and Markdown files into clean, normalized JSON. It’s built specifically to prepare data for
[celestial.decaded.dev](https://celestial.decaded.dev), but it can work with any similar dataset structure.

This parser handles inconsistent CSV headers, Markdown formatting quirks, missing fields, and source-specific oddities so the data is ready to be consumed by the main project
without manual cleanup.

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
- Produces backend-compatible `perks` and `generatorSources` NyaDB records.
- Generates deterministic RFC 4122 v5 perk IDs from input locations.
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

4. The normalized records are written to `NyaDB/perks_{source-id}.json`, one file per source, plus `NyaDB/generatorSources.json`.

You can run the parser directly:

```bash
node index.js
```

Run the regression tests with:

```bash
npm test
```

Optionally, start the web interface with:

```bash
npm run web
```

The web interface accepts CSV and Markdown uploads and writes prepared databases to `NyaDB/` using [@decaded/nyadb](https://github.com/Decaded/NyaDB).

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
'lewd': 'companion_lewd',
```

To group physical source files as selectable versions, configure `shared.sourceVersions`:

```js
grimoire: {
  displayName: 'Grimoire',
  defaultVersion: 'default',
  versions: {
    default: 'grimoire',
    v2: 'grimoire_v2',
    yggdrasil: 'grimoire_yggdrasil_personal',
  },
},
```

Unlisted source folders are published as independent sources. Every mapped physical source must exist and can belong to only one logical source.

Markdown parsing rules live in `md-parser.js`. When a new Markdown export has a weird entry layout, add a small regression case in `test/md-parser.test.js` before changing the
parser.

To inspect Markdown parse quality without dumping a huge source file, run:

```bash
node scripts/md-diagnose.js "sheets/DatasetName/source.md"
```

---

## Output format

The script writes one NyaDB record per source plus source metadata:

- `perks_{source-id}` - normalized perks for one source, keyed by UUID.
- `generatorSources` - source metadata keyed by source ID.

Each perk ID is a deterministic RFC 4122 v5 UUID derived from its input location. The generator validates the output before writing it.

Example perk record:

```json
{
 "Example Chapter": [
    {
     "id": "00000000-0000-5000-8000-000000000000",
       "cost": 200,
       "name": "Example Perk",
       "description": "Cleaned description here.",
       "category": "example",
     "chapter": "Example Chapter",
     "source": "Example Jump"
      }
 ]
 }
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

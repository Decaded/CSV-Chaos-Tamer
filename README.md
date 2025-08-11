# CSV Chaos Tamer

A Node.js script that processes multiple differently formatted CSV files into clean, normalized JSON. It’s built specifically to prepare data for
[celestial.decaded.dev](https://celestial.decaded.dev), but it can work with any similar dataset structure.

This parser handles inconsistent headers, missing fields, and various formatting quirks so the data is ready to be consumed by the main project without manual cleanup.

---

## Why this exists

[celestial.decaded.dev](https://celestial.decaded.dev) is a database-driven project that relies on a large number of community-sourced datasets. The problem is that these datasets
are often messy:

- Column names vary wildly between files.
- Some datasets bury important metadata in filenames instead of proper columns.
- Formatting can change mid-series due to different contributors.

The CSV Chaos Tamer standardizes this chaos into a consistent JSON format that celestial can read without breaking. It’s not just a parser -- it’s the gatekeeper that ensures
imported data actually makes sense.

---

## What it does

- Handles multiple CSV formats without requiring a separate config for each.
- Normalizes headers so variations like `Price`, `cost`, and `CPCost` are unified under `cost`.
- Detects chapter information from either a column or the filename.
- Splits out specific chapters into their own JSON files if configured.
- Cleans text by trimming whitespace, fixing newlines, and removing stray characters.
- Can be easily extended to support new header mappings or split rules.

---

## How to set it up

1. Place CSV files into subfolders inside `sheets/`:

```bash
sheets/
└── DatasetName/
    ├── file1.csv
    └── file2.csv
```

2. Install dependencies:

```bash
npm install
```

3. Run the parser:

```bash
node index.js
```

4. Collect your cleaned JSON from `data/`.

---

## Customizing

If your CSVs use unique or inconsistent headers, edit the `headerMap`:

```js
cpcost: 'cost',
price: 'cost',
perkname: 'name',
setting: 'source',
```

If you need to split specific chapters into separate files, modify `SPLIT_CHAPTERS`:

```js
'waifu catalogue': 'waifu',
'lewd': 'companion_(lewd)',
```

---

## Output format

The script generates one JSON file per input folder, plus any additional split chapter files.

Example output:

```json
{
	"1": [
		{
			"id": 1,
			"cost": 200,
			"name": "Example Perk",
			"source": "Example Jump",
			"chapter": "Example Chapter",
			"description": "Cleaned description here.",
			"__source": "file1",
			"__line": 2
		}
	]
}
```

---

## Requirements

- Node.js 16 or newer
- CSV files encoded in UTF-8

---

## License

[MIT License](LICENSE) – free to use, modify, and distribute.

---

## Support the project

If this tool or [celestial.decaded.dev](https://celestial.decaded.dev) has been useful to you, consider supporting development:
[https://ko-fi.com/decaded](https://ko-fi.com/decaded)

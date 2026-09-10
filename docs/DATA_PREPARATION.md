# Dataset Builder Data Contract

This document defines how data should be prepared for the Celestial Gambler API based on current runtime behavior.

This document is self-contained and is the practical source of truth for preparing NyaDB inputs that load successfully.

## Input Databases

The API reads these special databases from NyaDB:

- `dataset` (dataset-level metadata)
- `categories` (category and version metadata)
- `sources` (source metadata)

Perk data is read from all other databases except reserved names:

- Reserved and excluded from perk scanning: `dataset`, `categories`, `sources`, `database_backup`

Within each perk database payload, top-level keys `metadata` and `_metadata` are treated as metadata keys and not source records.

## Required Logical Outputs

Prepare these logical outputs:

1. Dataset metadata (optional but recommended)
2. Category metadata (recommended; required for strict category/version validation)
3. Source metadata (recommended)
4. Perk hierarchy grouped by source, chapter, and name key

## Hard Failure Rules (What Fails Startup)

The API fails startup when any of the following occurs.

### Category metadata failures

If category metadata is provided, each category version must define:

- `id`
- `database`

Failures:

- Missing `id` or `database` in a version
- Duplicate version IDs in the same category
- `defaultVersion` not found in that category's versions
- Category versions referencing databases that do not exist in NyaDB

### Perk/category consistency failures (when category metadata exists)

If category metadata is present, each perk must resolve to a known category and category version.

Failures:

- Perk references unknown category
- Perk references unknown category version
- Perk is stored in a database different from the version's configured `database`

### Perk ID failures

Failures:

- Missing or empty perk `id`
- Duplicate perk `id` anywhere in the merged dataset

### Empty perk data failures

Failure:

- No perk dataset files are loaded after category database filtering and reserved DB exclusion

## Accepted With Normalization (No Hard Failure)

The API accepts some imperfect inputs and normalizes them.

- `isAdult` is coerced with JavaScript truthiness (`Boolean(value)`)
- `tags` becomes `[]` when not an array
- `nameKey` defaults to the enclosing perk-group key
- Missing `category` defaults to current database name
- Missing `categoryVersion` defaults to `default`
- Source metadata entry is not strictly required if the source node itself has usable fields
- Non-array perk groups are skipped (not rejected)

Because of this behavior, builders should still emit clean typed data to avoid semantic surprises.

## Dataset Metadata

`dataset` database should contain either:

- A flat metadata object
- Or an object with nested `metadata`

Example (flat):

```json
{
	"name": "Celestial Gambler Dataset",
	"datasetVersion": "2026.07.1",
	"description": "Public Celestial Gambler perk dataset."
}
```

Example (nested):

```json
{
	"metadata": {
		"name": "Celestial Gambler Dataset",
		"datasetVersion": "2026.07.1"
	}
}
```

If both dataset-level and perk-database metadata exist, metadata is merged.

## Category Metadata

`categories` database should include a `categories` array (or equivalent object map shape), with version records including a database mapping.

Example:

```json
{
	"categories": [
		{
			"id": "forge",
			"displayName": "Forge",
			"defaultVersion": "default",
			"versions": [
				{
					"id": "default",
					"displayName": "Forge",
					"database": "forge"
				}
			]
		},
		{
			"id": "grimoire",
			"displayName": "Grimoire",
			"defaultVersion": "default",
			"versions": [
				{
					"id": "default",
					"displayName": "Grimoire",
					"database": "grimoire"
				},
				{
					"id": "v2",
					"displayName": "Grimoire V2",
					"database": "grimoire_v2"
				}
			]
		}
	]
}
```

Notes:

- If `categories` metadata is omitted, category config is derived from observed perk data.
- If category metadata exists, it is authoritative for category/version/database validation.

## Source Metadata

`sources` database should provide source records keyed by `id` or as an array.

Example:

```json
{
	"sources": [
		{
			"id": "source_forge_master",
			"name": "Forge Master",
			"displayName": "Forge Master",
			"description": "Forge Master perks and upgrades.",
			"categories": ["forge", "scrolls"]
		}
	]
}
```

Notes:

- Missing source metadata does not automatically fail load.
- Source node fields in perk databases can supply fallback display values.

## Perk Hierarchy Shape

Perk databases are expected in this hierarchy:

```text
sourceId -> chapters -> chapterKey -> perks -> nameKey -> Perk[]
```

Example:

```json
{
	"metadata": {},
	"source_fate_grand_master": {
		"source": "Fate/Grand Master",
		"description": "Perks from Fate/Grand Master.",
		"chapters": {
			"parameters": {
				"chapter": "Parameters",
				"perks": {
					"arcane_tuning": [
						{
							"id": "perk_184292",
							"cost": 2,
							"name": "Arcane Tuning",
							"description": "Tune the spell to optimize power delivery.",
							"category": "grimoire",
							"categoryVersion": "v2",
							"categoryDisplayName": "Grimoire V2",
							"tags": ["magic", "utility"],
							"isAdult": false
						}
					]
				}
			}
		}
	}
}
```

## Perk Record Guidance

To avoid normalization pitfalls, emit these fields with correct types:

- `id`: non-empty string (must be globally unique)
- `cost`: number
- `name`: string
- `description`: string
- `category`: string
- `categoryVersion`: string
- `categoryDisplayName`: string
- `tags`: string array
- `isAdult`: boolean

Strong recommendation:

- Do not emit string booleans like `"false"` for `isAdult`; they become truthy.
- Do not rely on fallback defaults for `category` and `categoryVersion`.

## ID and Key Conventions (Recommended)

The API does not strictly regex-validate IDs/keys except non-empty/duplicate perk IDs.
Still, use stable machine-safe identifiers for long-term compatibility:

```text
^[a-z0-9_-]+$
```

Recommended for:

- Perk IDs
- Source IDs
- Chapter keys
- Name keys
- Category IDs
- Version IDs
- Database keys

## Determinism Recommendations

The API enforces only uniqueness/non-empty perk IDs, but builders should keep deterministic output:

- Stable perk IDs across builds
- Stable ordering by category/version, source, chapter, name key, perk ID
- No ID reuse for removed perks

## Practical Validation Checklist

Before publishing to NyaDB, verify:

- Every perk has a non-empty unique `id`
- Every category version has `id` + `database`
- Every category `defaultVersion` exists
- Every referenced version database actually exists in NyaDB
- Perks in versioned databases declare matching `category` and `categoryVersion`
- `isAdult` values are booleans
- `tags` values are string arrays
- Perk groups are arrays

This checklist matches actual API behavior and prevents startup failures or silent coercion.

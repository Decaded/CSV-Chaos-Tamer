# Generator Source Metadata

`NyaDB/generatorSources.json` is the source of truth for the Generator source picker. It is produced by CSV Chaos Tamer and deployed manually beside the per-source perk records.

## Storage Layout

- `generatorSources.json`: logical source metadata, keyed by logical source ID.
- `perks_<fileKey>.json`: perks for one physical edition, keyed by perk UUID.

Each record in `generatorSources.json` is a **Source** (a selectable collection) that exposes one or more **Editions** (physical files). The `fileKey` of each edition corresponds
exactly to one `perks_<fileKey>.json` file.

For example, the logical `grimoire` source exposes the `grimoire`, `grimoire_v2`, `grimoire_v3`, `grimoire_v6`, and `grimoire_yggdrasil_personal` editions. Each remains a separate
physical file.

## Metadata Shape

```json
{
	"grimoire": {
		"id": "grimoire",
		"displayName": "Grimoire",
		"description": "Magical abilities and powers.",
		"isMature": false,
		"defaultVersion": "default",
		"editions": [
			{
				"fileKey": "grimoire",
				"version": "default",
				"sourceUrl": "https://docs.google.com/spreadsheets/d/1DmxG5BPs7YVe5u1F1GG70ZGYKOsqeABQVyqv4hi_k98",
				"altSourceUrl": "https://docs.google.com/spreadsheets/d/EXAMPLE",
				"altSourceLabel": "sheet version by Celestial Dragon"
			},
			{ "fileKey": "grimoire_v2", "version": "v2", "sourceUrl": "https://docs.google.com/spreadsheets/d/V2" }
		]
	}
}
```

`editions[].fileKey` is the physical file ID and corresponds to `perks_<fileKey>.json`. `editions[].version` is the stable UI/API version label. `defaultVersion` must match the
`version` of exactly one edition in the source. Every `fileKey` across all sources must be unique (a file belongs to exactly one source/edition), and every `perks_<fileKey>.json`
file must be covered by the `editions` list (and vice versa).

### Perk Records

Every perk record in `perks_<fileKey>.json` carries its own mapping context so the records are self-describing:

```json
{
	"id": "00000000-0000-5000-8000-000000000000",
	"sourceId": "grimoire",
	"edition": "default",
	"chapter": "Arcane Arts",
	"name": "Spellcraft",
	"cost": 100,
	"description": "You can cast spells.",
	"origin": "Celestial Grimoire"
}
```

- `sourceId` and `edition` are constant for every perk in a file and always match the file's source/edition mapping in `generatorSources.json`.
- `origin` is the based-on work this perk comes from (the originating document section). It is omitted entirely when the row has no origin value.

### Field Requirements

- `description` **must** be real, user-facing short copy describing the source's content (e.g. "Magical abilities and powers."). Do not use a templated placeholder like "Perks from
  X."
- Every edition `sourceUrl` is **required** and must link to that edition's public document/spreadsheet. It cannot be empty.
- `altSourceUrl` / `altSourceLabel` are **optional**, used only when an edition has a second/alternate document (e.g. a community-maintained sheet version of a Google Doc source).
  Both must be provided together, or omitted together.
- `displayName` should match the source's public-facing name as advertised in the JumpChain community (e.g. "Complete Companion", not "Companion").

CSV Chaos Tamer validates mapping uniqueness, file/edition parity, source existence, per-edition links, and UUID shape before writing its NyaDB records. When adding a new source by
hand, ensure `description` and every edition `sourceUrl` are filled in with real content per the Field Requirements above.

## Manual Metadata Config

`source-metadata.config.json` (in `src/config/`) is the dedicated, hand-maintained file that supplies `description`, per-edition links, and (optionally) `name` for every logical
source, keyed by logical source ID. It is the **source of truth for both grouping and links**: every entry declares an `editions` map that explicitly groups that source's physical
files into selectable editions. Each entry uses a single uniform shape:

```json
{
	"grimoire": {
		"name": "Grimoire",
		"description": "Magical abilities and powers.",
		"defaultVersion": "default",
		"editions": {
			"default": {
				"fileKey": "grimoire",
				"sourceUrl": "https://docs.google.com/spreadsheets/d/1DmxG5BPs7YVe5u1F1GG70ZGYKOsqeABQVyqv4hi_k98",
				"altSourceUrl": "https://docs.google.com/spreadsheets/d/EXAMPLE",
				"altSourceLabel": "sheet version by Celestial Dragon"
			},
			"v2": {
				"fileKey": "grimoire_v2",
				"sourceUrl": "https://docs.google.com/spreadsheets/d/V2"
			}
		}
	}
}
```

There is **no** per-source level URL in this config: every link lives on an edition. All fields other than `description` and `editions` are optional.

- Edition keys (`default`, `v2`, `yggdrasil`, …) are machine-id-safe version labels shown in the Generator source picker.
- Each edition carries its own `fileKey` (matches `perks_<fileKey>.json`) and a required non-empty `sourceUrl`.
- `altSourceUrl` / `altSourceLabel` are optional per-edition links for an alternate copy of the same document; both must be provided together or omitted together.
- `defaultVersion` is optional and defaults to `default`; it must be one of the declared edition keys. A source with no `default` edition must set an explicit `defaultVersion`.
- The web panel's per-source **Add edition** button edits exactly this map (version + file key + source URL + alt URL + alt label + default marker).

Every entry must declare its full `editions` map, so the on-disk grouping config is authoritative and self-consistent. (Programmatic callers that pass `sourceGroups: {}` still fall
back to automatic per-folder edition detection in the build layer, but the shipped config never relies on that path.)

This file must be updated manually before running the generator. It is a hard gate: the generator refuses to write any NyaDB records (throws instead) if:

- a generated logical source has no matching entry in `source-metadata.config.json`, or
- `source-metadata.config.json` has an entry for a source ID that no longer exists, or
- an entry is missing a non-empty `description`, or has an `editions` map missing entirely or empty, or
- an entry still carries a top-level `sourceUrl` / `altSourceUrl` / `altSourceLabel`, or uses the legacy `editionUrls` field, or
- an edition is missing a `fileKey`, or the edition's version/fileKey does not match the generated source, or the edition has an empty `sourceUrl`, or
- `altSourceUrl`/`altSourceLabel` are not both present or both absent on an edition, or
- `defaultVersion` (if set) is not one of the declared edition versions, or a source has neither a `default` edition nor a `defaultVersion`, or
- a generated edition is not declared in the entry's `editions` map.

`name` is **optional**: the source's public-facing display name, e.g. "Complete Companion". When present it overrides the `displayName` derived from the logical source ID, so it
also applies to the Generator source picker and the mature auto-marking keyword match. When omitted, the panel shows a placeholder derived from the ID and the build keeps the derived
display name.

Manual `description` replaces the auto-generated placeholder description in the final `generatorSources.json` output. Edition links are applied as follows:

- A per-edition `sourceUrl` (from the `editions` map) is placed directly on that edition.
- A per-edition `altSourceUrl` / `altSourceLabel` pair is placed on that edition when both are present.

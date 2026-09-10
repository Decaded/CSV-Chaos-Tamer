# Generator Source Metadata

`NyaDB/generatorSources.json` is the source of truth for the Generator source picker. It is produced by CSV Chaos Tamer and deployed manually beside the per-source perk records.

## Storage Layout

- `generatorSources.json`: logical source metadata, keyed by logical source ID.
- `perks_<physical-source-id>.json`: perks for one physical source/version, keyed by perk UUID.

For example, the logical `grimoire` source can expose `grimoire`, `grimoire_v2`, and `grimoire_v3` as selectable versions. Each remains a separate physical file.

## Metadata Shape

```json
{
	"grimoire": {
		"id": "grimoire",
		"displayName": "Grimoire",
		"description": "Magical abilities and powers.",
		"sourceUrl": "https://docs.google.com/spreadsheets/d/1DmxG5BPs7YVe5u1F1GG70ZGYKOsqeABQVyqv4hi_k98",
		"altSourceUrl": "https://docs.google.com/spreadsheets/d/EXAMPLE",
		"altSourceLabel": "sheet version by Celestial Dragon",
		"isR18": false,
		"defaultVersion": "default",
		"categories": [
			{ "id": "grimoire", "version": "default" },
			{ "id": "grimoire_v2", "version": "v2" },
			{ "id": "grimoire_v3", "version": "v3" }
		]
	}
}
```

`categories[].id` is the physical source ID and corresponds to `perks_<id>.json`. `categories[].version` is the stable UI/API version label. `defaultVersion` must match exactly one
entry.

### Field Requirements

- `description` **must** be real, user-facing short copy describing the source's content (e.g. "Magical abilities and powers."). Do not use a templated placeholder like "Perks from
  X."
- `sourceUrl` is **required** and must link to the source's public document/spreadsheet. Use an empty string `""` only as a temporary placeholder while a link is unavailable.
- `altSourceUrl` / `altSourceLabel` are **optional**, used only when a source has a second/alternate document (e.g. a community-maintained sheet version of a Google Doc source).
  Both must be provided together, or omitted together.
- `displayName` should match the source's public-facing name as advertised in the JumpChain community (e.g. "Complete Companion", not "Companion").

CSV Chaos Tamer validates mapping uniqueness, source existence, and UUID shape before writing its NyaDB records. When adding a new source by hand, ensure `description` and
`sourceUrl` are filled in with real content per the Field Requirements above.

## Manual Metadata Config

`source-metadata.config.json` (in `src/config/`) is the dedicated, hand-maintained file that supplies `description`, `sourceUrl`, `altSourceUrl`, and `altSourceLabel` for every logical
source, keyed by logical source ID:

```json
{
	"grimoire": {
		"description": "Magical abilities and powers.",
		"sourceUrl": "https://docs.google.com/spreadsheets/d/1DmxG5BPs7YVe5u1F1GG70ZGYKOsqeABQVyqv4hi_k98"
	}
}
```

This file must be updated manually before running the generator. It is a hard gate: the generator refuses to write any NyaDB records (throws instead) if:

- a generated logical source has no matching entry in `source-metadata.config.json`, or
- `source-metadata.config.json` has an entry for a source ID that no longer exists, or
- an entry is missing a non-empty `description` or `sourceUrl`, or
- `altSourceUrl`/`altSourceLabel` are not both present or both absent.

Manual `description`/`sourceUrl`/`altSourceUrl`/`altSourceLabel` values fully replace the auto-generated placeholder description in the final `generatorSources.json` output.

/**
 * Global configuration for CSV and Markdown parsing.
 * All settings live here; parsers import what they need.
 */

// ───────────────────── Shared ─────────────────────

const shared = {
	/** Public dataset metadata written to data/dataset.json */
	dataset: {
		name: 'Celestial Gambler Dataset',
		datasetVersion: '2026.06.1',
		description: 'Public Celestial Gambler perk dataset.',
	},

	/** Chapters that get split into separate JSON files. key = lowercase chapter, value = output filename (no extension) */
	splitChapters: {
		'waifu catalogue': 'waifu',
		'lewd': 'companion_lewd',
	},

	/** Databases that should mark every contained perk as adult content. */
	adultDatabases: ['bordello', 'companion_lewd', 'debauchery'],

	/** Description cleanup – reused by both CSV and MD transforms */
	cleanDescription: v =>
		String(v ?? '')
			.replace(/[\r\t]+/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.replace(/(?<!\n)\n(?!\n)/g, ' ')
			.replace(/\s{2,}/g, ' ')
			.trim(),

	/** Convert a string to a machine-ID-safe slug */
	slugify: str =>
		String(str ?? '')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/^Copy of\s*/i, '')
			.replace(/['’]/g, '')
			.replace(/&/g, ' and ')
			.replace(/[^a-zA-Z0-9_-]+/g, '_')
			.replace(/_+/g, '_')
			.replace(/^_+|_+$/g, '')
			.toLowerCase(),
};

// ───────────────────── CSV ─────────────────────

const csv = {
	/**
	 * Maps raw CSV headers (lowercased, alpha-only) or column indices to standard field names.
	 */
	headerMap: {
		0: 'id',
		unnamed0: 'id',
		cpcost: 'cost',
		cost: 'cost',
		price: 'cost',
		name: 'name',
		item: 'name',
		perkname: 'name',
		jump: 'source',
		jumpdoc: 'source',
		jumpchain: 'source',
		source: 'source',
		setting: 'source',
		chapter: 'chapter',
		category: 'chapter',
		description: 'description',
	},

	/** Fallback headers when no CSV headers are detected */
	fallbackHeaders: ['CP Cost', 'Name', 'Jumpdoc', 'Description'],

	/** Per-field transforms applied to parsed CSV rows */
	transforms: {
		id: v => Number(String(v).replace(/cp$/i, '').trim()) || 0,
		cost: v => Number(String(v).replace(/cp$/i, '').trim()) || 0,
		description: v => shared.cleanDescription(v),
		chapter: v => v?.trim(),
	},
};

// ───────────────────── Markdown ─────────────────────

const md = {
	/**
	 * Separator inserted between folded sub-sections in descriptions.
	 * Use '\n\n' for a blank line, '\n' for a single newline, or any string.
	 */
	subSectionSeparator: '\n\n',

	/** Per-field transforms applied to parsed MD rows */
	transforms: {
		id: v => {
			if (v === null || v === undefined) return null;
			return Number(String(v).replace(/\D/g, '')) || null;
		},
		cost: v => {
			const str = String(v).trim();
			// Remove zero-width spaces and other invisible Unicode characters
			const cleaned = str
				.replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
				.replace(/^-/, '')
				.replace(/[()[\]]/g, '')
				.trim();
			const num = Number(
				cleaned
					.replace(/cp$/i, '')
					.replace(/\s*bp$/i, '')
					.replace(/\s*kp$/i, '')
					.replace(/\s+(?:CP|BP|KP)$/i, '')
					.trim(),
			);
			return isNaN(num) ? (cleaned.toLowerCase() === 'free' ? 0 : str) : num;
		},
		name: v =>
			String(v || '')
				.replace(/[\u200B\u200C\u200D\uFEFF]/g, '') // Remove zero-width spaces
				.replace(/^\*+/, '')
				.trim(),
		description: v => {
			// Remove escape sequences: \* → *, \[ → [, \] → ], \! → !, \' → ', \" → ", \< → <, \> → >
			const s = String(v ?? '').replace(/\\([*[\]!?.'\"<>])/g, '$1');
			return s
				.replace(/[\r\t]+/g, '')
				.replace(/\n{3,}/g, '\n\n') // cap at double-newline
				.replace(/(?<!\n)\n(?!\n)/g, ' ') // single newlines → space
				.replace(/[^\S\n]{2,}/g, ' ') // collapse horizontal whitespace only
				.replace(/\n{2,}/g, md.subSectionSeparator) // apply configured separator
				.trim();
		},
	},
};

module.exports = { shared, csv, md };

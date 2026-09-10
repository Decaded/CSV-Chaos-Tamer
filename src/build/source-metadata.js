const fs = require('fs');
const path = require('path');

const SOURCE_METADATA_CONFIG_PATH = path.join(__dirname, '..', 'config', 'source-metadata.config.json');

/**
 * Loads the hand-maintained per-source metadata (description, sourceUrl, ...) that
 * generator runs are gated on. See SOURCE_METADATA.md for the required shape.
 * @param {string} configPath - Path to the manual metadata JSON file
 * @returns {Record<string, object>} Manual metadata keyed by logical source id
 */
function loadSourceMetadataConfig(configPath = SOURCE_METADATA_CONFIG_PATH) {
	let raw;
	try {
		raw = fs.readFileSync(configPath, 'utf8');
	} catch (err) {
		throw new Error(`Unable to read source metadata config at ${configPath}: ${err.message}`);
	}
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw new Error(`Invalid JSON in source metadata config at ${configPath}: ${err.message}`);
	}
}

/**
 * Validates that generated sources and the manual metadata config are in lockstep:
 * every generated source must have a manual entry and vice versa, with required fields present.
 * @param {object[]} sources - Generated source metadata entries
 * @param {Record<string, object>} manualConfig - Manual metadata keyed by logical source id
 * @returns {string[]} Validation error messages, empty if valid
 */
function validateSourceMetadataConfig(sources, manualConfig) {
	const errors = [];
	const sourcesById = new Map(sources.map(source => [source.id, source]));
	const sourceIds = new Set(sourcesById.keys());

	for (const sourceId of sourceIds) {
		if (!Object.hasOwn(manualConfig, sourceId)) errors.push(`Source ${sourceId} is missing a source-metadata.config.json entry`);
	}
	for (const sourceId of Object.keys(manualConfig)) {
		if (!sourceIds.has(sourceId)) errors.push(`source-metadata.config.json has an entry for unknown source ${sourceId}`);
	}

	for (const [sourceId, entry] of Object.entries(manualConfig)) {
		if (!entry || typeof entry !== 'object') {
			errors.push(`source-metadata.config.json entry for ${sourceId} must be an object`);
			continue;
		}
		if (typeof entry.description !== 'string' || !entry.description.trim()) errors.push(`source-metadata.config.json entry for ${sourceId} is missing a description`);
		if (typeof entry.sourceUrl !== 'string' || !entry.sourceUrl.trim()) errors.push(`source-metadata.config.json entry for ${sourceId} is missing a sourceUrl`);
		if (Boolean(entry.altSourceUrl) !== Boolean(entry.altSourceLabel))
			errors.push(`source-metadata.config.json entry for ${sourceId} must set altSourceUrl and altSourceLabel together`);

		if (entry.categoryUrls !== undefined) {
			if (!entry.categoryUrls || typeof entry.categoryUrls !== 'object' || Array.isArray(entry.categoryUrls)) {
				errors.push(`source-metadata.config.json entry for ${sourceId} has an invalid categoryUrls`);
			} else {
				const categoryIds = new Set((sourcesById.get(sourceId)?.categories || []).map(category => category.id));
				for (const [categoryId, url] of Object.entries(entry.categoryUrls)) {
					if (!categoryIds.has(categoryId)) errors.push(`source-metadata.config.json entry for ${sourceId} has a categoryUrls entry for unknown category ${categoryId}`);
					if (typeof url !== 'string' || !url.trim()) errors.push(`source-metadata.config.json entry for ${sourceId} has an empty categoryUrls entry for ${categoryId}`);
				}
			}
		}
	}

	return errors;
}

/**
 * Merges manually-maintained metadata into generated sources, replacing the auto-generated description.
 * @param {object[]} sources - Generated source metadata entries, mutated in place
 * @param {Record<string, object>} manualConfig - Manual metadata keyed by logical source id
 */
function applySourceMetadataOverrides(sources, manualConfig) {
	for (const source of sources) {
		const entry = manualConfig[source.id];
		if (!entry) continue;
		source.description = entry.description;
		source.sourceUrl = entry.sourceUrl;
		if (entry.altSourceUrl && entry.altSourceLabel) {
			source.altSourceUrl = entry.altSourceUrl;
			source.altSourceLabel = entry.altSourceLabel;
		}
		if (entry.categoryUrls) {
			for (const category of source.categories) {
				const categoryUrl = entry.categoryUrls[category.id];
				if (categoryUrl) category.sourceUrl = categoryUrl;
			}
		}
	}
}

module.exports = {
	SOURCE_METADATA_CONFIG_PATH,
	loadSourceMetadataConfig,
	validateSourceMetadataConfig,
	applySourceMetadataOverrides,
};
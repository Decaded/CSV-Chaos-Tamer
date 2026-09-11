const fs = require('fs');
const path = require('path');
const { MACHINE_ID_RE } = require('../helpers');

const SOURCE_METADATA_CONFIG_PATH = path.join(__dirname, '..', 'config', 'source-metadata.config.json');

/**
 * Loads the hand-maintained per-source metadata (description, sourceUrl, editions, ...) that
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
 * Derives the source edition group map consumed by buildFileEditions from the manual metadata
 * config. Only sources that declare an explicit `editions` map are grouped; every other source
 * falls back to automatic detection in buildFileEditions.
 * Output shape: { [sourceId]: { defaultVersion, editions: { [version]: fileKey } } }
 * @param {Record<string, object>} manualConfig - Manual metadata keyed by logical source id
 * @returns {Record<string, { defaultVersion: string, editions: Record<string, string> }>}
 */
function deriveSourceEditionsConfig(manualConfig) {
	const groups = {};
	for (const [sourceId, entry] of Object.entries(manualConfig || {})) {
		if (!entry || typeof entry !== 'object') continue;
		if (!entry.editions || typeof entry.editions !== 'object' || Array.isArray(entry.editions)) continue;
		const editionKeys = Object.keys(entry.editions);
		if (!editionKeys.length) continue;
		groups[sourceId] = {
			defaultVersion: typeof entry.defaultVersion === 'string' && entry.defaultVersion ? entry.defaultVersion : 'default',
			editions: {},
		};
		for (const [version, edition] of Object.entries(entry.editions)) {
			const fileKey = typeof edition === 'string' ? edition : edition && typeof edition === 'object' ? edition.fileKey : undefined;
			if (typeof fileKey === 'string' && fileKey) groups[sourceId].editions[version] = fileKey;
		}
	}
	return groups;
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
		if (entry.name !== undefined && (typeof entry.name !== 'string' || !entry.name.trim()))
			errors.push(`source-metadata.config.json entry for ${sourceId} has an invalid name`);
		if (entry.sourceUrl !== undefined) errors.push(`source-metadata.config.json entry for ${sourceId} must not carry a top-level sourceUrl (put links on each edition)`);
		if (entry.altSourceUrl !== undefined || entry.altSourceLabel !== undefined)
			errors.push(`source-metadata.config.json entry for ${sourceId} must not carry top-level altSourceUrl/altSourceLabel (put links on each edition)`);
		if (entry.editionUrls !== undefined) errors.push(`source-metadata.config.json entry for ${sourceId} must not use the legacy editionUrls field`);

		if (!entry.editions || typeof entry.editions !== 'object' || Array.isArray(entry.editions)) {
			errors.push(`source-metadata.config.json entry for ${sourceId} is missing an editions map`);
			continue;
		}
		const editionKeys = Object.keys(entry.editions);
		if (!editionKeys.length) {
			errors.push(`source-metadata.config.json entry for ${sourceId} has an empty editions map`);
			continue;
		}
		if (typeof entry.defaultVersion === 'string' && entry.defaultVersion && !editionKeys.includes(entry.defaultVersion)) {
			errors.push(`source-metadata.config.json entry for ${sourceId} has a defaultVersion that is not an editions key`);
		}
		if ((typeof entry.defaultVersion !== 'string' || !entry.defaultVersion) && !editionKeys.includes('default')) {
			errors.push(`source-metadata.config.json entry for ${sourceId} must include a "default" edition or set a defaultVersion`);
		}

		const editionByVersion = new Map((sourcesById.get(sourceId)?.editions || []).map(edition => [edition.version, edition.fileKey]));
		const generatedVersions = new Set((sourcesById.get(sourceId)?.editions || []).map(edition => edition.version));
		for (const [version, edition] of Object.entries(entry.editions)) {
			if (!MACHINE_ID_RE.test(version)) errors.push(`source-metadata.config.json entry for ${sourceId} has an invalid edition version ${version}`);
			const fileKey = typeof edition === 'string' ? edition : edition && typeof edition === 'object' ? edition.fileKey : null;
			if (typeof fileKey !== 'string' || !fileKey.trim()) {
				errors.push(`source-metadata.config.json entry for ${sourceId} is missing a fileKey for edition ${version}`);
				continue;
			}
			if (!editionByVersion.has(version) || editionByVersion.get(version) !== fileKey) {
				errors.push(`source-metadata.config.json entry for ${sourceId} maps edition ${version} to ${fileKey} but the generated source does not`);
				continue;
			}
			if (typeof edition !== 'object' || edition === null) {
				errors.push(`source-metadata.config.json entry for ${sourceId} uses a bare fileKey for edition ${version}; editions must be objects with a sourceUrl`);
				continue;
			}
			if (typeof edition.sourceUrl !== 'string' || !edition.sourceUrl.trim()) errors.push(`source-metadata.config.json entry for ${sourceId} has an empty sourceUrl for edition ${version}`);
			if (Boolean(edition.altSourceUrl) !== Boolean(edition.altSourceLabel))
				errors.push(`source-metadata.config.json entry for ${sourceId} must set altSourceUrl and altSourceLabel together for edition ${version}`);
			if (edition.altSourceUrl !== undefined && (typeof edition.altSourceUrl !== 'string' || !edition.altSourceUrl.trim()))
				errors.push(`source-metadata.config.json entry for ${sourceId} has an empty altSourceUrl for edition ${version}`);
		}
		for (const version of generatedVersions) {
			if (!Object.hasOwn(entry.editions, version)) errors.push(`source-metadata.config.json entry for ${sourceId} does not declare edition ${version}`);
		}
	}

	return errors;
}

/**
 * Merges manually-maintained metadata into generated sources, replacing the auto-generated description.
 * Every edition's sourceUrl/altSourceUrl/altSourceLabel come from the config's `editions` map, so the
 * finished source metadata carries exactly the configured per-edition links.
 * @param {object[]} sources - Generated source metadata entries, mutated in place
 * @param {Record<string, object>} manualConfig - Manual metadata keyed by logical source id
 */
function applySourceMetadataOverrides(sources, manualConfig) {
	for (const source of sources) {
		const entry = manualConfig[source.id];
		if (!entry) continue;
		if (entry.name) source.displayName = entry.name;
		source.description = entry.description;

		const configEditions = entry.editions && typeof entry.editions === 'object' && !Array.isArray(entry.editions) ? entry.editions : {};
		for (const edition of source.editions) {
			const editionConfig = configEditions[edition.version];
			if (typeof editionConfig !== 'object' || editionConfig === null) continue;
			if (editionConfig.sourceUrl) edition.sourceUrl = editionConfig.sourceUrl;
			if (editionConfig.altSourceUrl && editionConfig.altSourceLabel) {
				edition.altSourceUrl = editionConfig.altSourceUrl;
				edition.altSourceLabel = editionConfig.altSourceLabel;
			}
		}
	}
}

module.exports = {
	SOURCE_METADATA_CONFIG_PATH,
	loadSourceMetadataConfig,
	deriveSourceEditionsConfig,
	validateSourceMetadataConfig,
	applySourceMetadataOverrides,
};
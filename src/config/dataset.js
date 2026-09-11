const fs = require('fs');
const path = require('path');

const { shared } = require('./settings');

const DEFAULT_DATASET_CONFIG_PATH = path.join(__dirname, 'dataset.json');

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Merge a raw config object over the shared defaults so every field is always set. */
function datasetFromConfig(config) {
	return {
		name: config?.name || shared.dataset.name,
		datasetVersion: config?.datasetVersion || shared.dataset.datasetVersion,
		description: config?.description || shared.dataset.description,
	};
}

/** Load the dataset config (name, datasetVersion, description) from disk, falling back to defaults. */
function loadDatasetConfig(datasetConfigPath = DEFAULT_DATASET_CONFIG_PATH) {
	if (typeof datasetConfigPath === 'string' && fs.existsSync(datasetConfigPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(datasetConfigPath, 'utf8'));
			if (isPlainObject(parsed)) return datasetFromConfig(parsed);
		} catch {
			// Malformed config — fall through to defaults.
		}
	}
	return datasetFromConfig(null);
}

/** Validate a full dataset config object. Returns a list of human-readable errors (empty when valid). */
function validateDatasetConfig(config) {
	if (!isPlainObject(config)) return ['Dataset config must be a JSON object'];
	const errors = [];
	for (const field of ['name', 'datasetVersion', 'description']) {
		const value = config[field];
		if (typeof value !== 'string' || !value.trim()) {
			errors.push(`Dataset config field "${field}" must be a non-empty string`);
		}
	}
	return errors;
}

module.exports = { DEFAULT_DATASET_CONFIG_PATH, loadDatasetConfig, validateDatasetConfig };
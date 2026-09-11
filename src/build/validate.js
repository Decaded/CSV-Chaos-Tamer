const { MACHINE_ID_RE } = require('../helpers');

function validateBackendGeneratorFiles({ files, sourceMetadata }) {
	const errors = [];
	const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	const categories = new Set(Object.keys(files));
	const mappedCategories = new Set();
	const ids = new Set();

	for (const source of sourceMetadata.sources) {
		if (!MACHINE_ID_RE.test(source.id) || !source.displayName || !source.description || typeof source.isR18 !== 'boolean' || typeof source.defaultVersion !== 'string') {
			errors.push(`Invalid source metadata for ${source.id}`);
		}
		if (!source.categories.some(category => category.version === source.defaultVersion)) errors.push(`Source ${source.id} has no mapped default version`);
		for (const category of source.categories) {
			if (!categories.has(category.id) || !MACHINE_ID_RE.test(category.version) || mappedCategories.has(category.id))
				errors.push(`Invalid source category mapping for ${category.id}`);
			mappedCategories.add(category.id);
		}
	}

	for (const [category, chapters] of Object.entries(files)) {
		if (!Object.keys(chapters).length) errors.push(`Category ${category} has no chapters`);
		for (const [chapter, perks] of Object.entries(chapters)) {
			if (!Array.isArray(perks)) errors.push(`Category ${category}, chapter ${chapter} is not an array`);
			for (const perk of perks) {
				if (!uuidPattern.test(perk.id) || ids.has(perk.id)) errors.push(`Invalid or duplicate perk UUID ${perk.id}`);
				ids.add(perk.id);
				if (perk.category !== category || perk.chapter !== chapter || !perk.name || !perk.description || !perk.source || !Number.isFinite(perk.cost) || perk.cost < 0) {
					errors.push(`Invalid perk ${perk.id}`);
				}
			}
		}
	}

	for (const category of categories) {
		if (!mappedCategories.has(category)) errors.push(`Category ${category} is missing source metadata`);
	}
	return errors;
}

function validatePreparedData({ dataset, categories, sources, grouped, items, changedIdCount, reusedOrRetiredIdCount }) {
	const errors = [];
	const ids = new Set();
	const categoryVersions = new Map();
	const databases = new Set(Object.keys(grouped));
	const sourceIds = new Set(sources.map(source => source.id));
	const forbiddenCountFields = ['totalPerks', 'perkCount', 'adultCount', 'categoryCount', 'sourceCount', 'chapterCount'];

	for (const field of ['name', 'datasetVersion']) {
		if (!dataset[field]) errors.push(`Dataset metadata missing ${field}`);
	}
	for (const field of forbiddenCountFields) {
		if (Object.prototype.hasOwnProperty.call(dataset, field)) errors.push(`Dataset metadata contains count field ${field}`);
	}

	for (const category of categories) {
		if (!MACHINE_ID_RE.test(category.id)) errors.push(`Invalid category ID: ${category.id}`);
		if (!category.displayName) errors.push(`Category ${category.id} missing displayName`);
		if (!Array.isArray(category.versions) || !category.versions.length) errors.push(`Category ${category.id} has no versions`);
		const versionIds = new Set();
		for (const version of category.versions || []) {
			if (!MACHINE_ID_RE.test(version.id)) errors.push(`Invalid version ID: ${category.id}:${version.id}`);
			if (!MACHINE_ID_RE.test(version.database)) errors.push(`Invalid database ID: ${version.database}`);
			if (!databases.has(version.database)) errors.push(`Version ${category.id}:${version.id} references missing database ${version.database}`);
			if (versionIds.has(version.id)) errors.push(`Duplicate version ID: ${category.id}:${version.id}`);
			versionIds.add(version.id);
			categoryVersions.set(`${category.id}:${version.id}`, version);
		}
		if (!versionIds.has(category.defaultVersion)) errors.push(`Category ${category.id} defaultVersion is not a version`);
	}

	for (const source of sources) {
		if (!MACHINE_ID_RE.test(source.id)) errors.push(`Invalid source ID: ${source.id}`);
		for (const field of ['name', 'displayName', 'description']) {
			if (!source[field]) errors.push(`Source ${source.id} missing ${field}`);
		}
		if (!Array.isArray(source.categories)) errors.push(`Source ${source.id} categories is not an array`);
	}

	for (const item of items) {
		const perk = item.perk;
		if (!MACHINE_ID_RE.test(item.sourceId)) errors.push(`Invalid item source ID: ${item.sourceId}`);
		if (!MACHINE_ID_RE.test(item.chapterKey)) errors.push(`Invalid chapter key: ${item.chapterKey}`);
		if (!MACHINE_ID_RE.test(item.nameKey)) errors.push(`Invalid name key: ${item.nameKey}`);
		if (!sourceIds.has(item.sourceId)) errors.push(`Perk ${perk.id} references missing source ${item.sourceId}`);
		if (!MACHINE_ID_RE.test(perk.id || '')) errors.push(`Invalid perk ID: ${perk.id}`);
		if (ids.has(perk.id)) errors.push(`Duplicate perk ID: ${perk.id}`);
		ids.add(perk.id);
		if (!Number.isFinite(perk.cost) || perk.cost < 0) {
			errors.push(
				`Perk ${perk.id} has invalid cost: ${perk.cost} ` + `(${item.database}/${item.sourceId}/${item.chapterKey}/${item.nameKey}, raw: ${JSON.stringify(item.rawCost)})`,
			);
		}
		if (!perk.name) errors.push(`Perk ${perk.id} missing name`);
		if (!perk.description) errors.push(`Perk ${perk.id} missing description`);
		if (!categoryVersions.has(`${perk.category}:${perk.categoryVersion}`)) {
			errors.push(`Perk ${perk.id} references missing category version ${perk.category}:${perk.categoryVersion}`);
		}
		if (typeof perk.isAdult !== 'boolean') errors.push(`Perk ${perk.id} has non-boolean isAdult`);
		if (!Array.isArray(perk.tags) || perk.tags.some(tag => typeof tag !== 'string')) errors.push(`Perk ${perk.id} has invalid tags`);
	}

	for (const [database, sourcesById] of Object.entries(grouped)) {
		if (!MACHINE_ID_RE.test(database)) errors.push(`Invalid grouped database ID: ${database}`);
		for (const [sourceId, source] of Object.entries(sourcesById)) {
			if (!sourceIds.has(sourceId)) errors.push(`Grouped source missing metadata: ${sourceId}`);
			for (const [chapterKey, chapter] of Object.entries(source.chapters || {})) {
				if (!MACHINE_ID_RE.test(chapterKey)) errors.push(`Invalid grouped chapter key: ${chapterKey}`);
				for (const [nameKey, perks] of Object.entries(chapter.perks || {})) {
					if (!MACHINE_ID_RE.test(nameKey)) errors.push(`Invalid grouped name key: ${nameKey}`);
					if (!Array.isArray(perks)) errors.push(`Perk group is not an array: ${database}/${sourceId}/${chapterKey}/${nameKey}`);
				}
			}
		}
	}

	if (changedIdCount) errors.push(`Changed ID count since previous render: ${changedIdCount}`);
	if (reusedOrRetiredIdCount) errors.push(`Reused or retired ID count: ${reusedOrRetiredIdCount}`);

	return errors;
}

module.exports = { validateBackendGeneratorFiles, validatePreparedData };
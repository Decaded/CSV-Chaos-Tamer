const { MACHINE_ID_RE } = require('../helpers');
const { shared } = require('../config/settings');

function validateBackendGeneratorFiles({ files, sourceMetadata }) {
	const errors = [];
	const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	const fileKeys = new Set(Object.keys(files));
	const mappedFileKeys = new Set();
	const ids = new Set();

	for (const source of sourceMetadata.sources) {
		if (!MACHINE_ID_RE.test(source.id) || !source.displayName || !source.description || typeof source.isR18 !== 'boolean' || typeof source.defaultVersion !== 'string') {
			errors.push(`Invalid source metadata for ${source.id}`);
		}
		for (const forbidden of ['sourceUrl', 'altSourceUrl', 'altSourceLabel']) {
			if (Object.prototype.hasOwnProperty.call(source, forbidden)) errors.push(`Source ${source.id} must not carry a top-level ${forbidden}`);
		}
		if (!Array.isArray(source.editions) || !source.editions.length) {
			errors.push(`Source ${source.id} has no editions`);
			continue;
		}
		if (!source.editions.some(edition => edition.version === source.defaultVersion)) errors.push(`Source ${source.id} has no default version edition`);
		for (const edition of source.editions) {
			if (!edition || typeof edition !== 'object') { errors.push(`Source ${source.id} has an invalid edition entry`); continue; }
			if (Object.prototype.hasOwnProperty.call(edition, 'id')) errors.push(`Source ${source.id} edition ${edition.id} uses id; must be fileKey`);
			if (Object.prototype.hasOwnProperty.call(edition, 'category')) errors.push(`Source ${source.id} edition ${edition.fileKey} uses category; must be fileKey`);
			if (!MACHINE_ID_RE.test(edition.fileKey) || !fileKeys.has(edition.fileKey) || mappedFileKeys.has(edition.fileKey)) errors.push(`Invalid source edition mapping for ${edition.fileKey}`);
			mappedFileKeys.add(edition.fileKey);
			if (!MACHINE_ID_RE.test(edition.version)) errors.push(`Invalid edition version for ${edition.fileKey}`);
			if (typeof edition.sourceUrl !== 'string') errors.push(`Edition ${edition.fileKey} is missing a sourceUrl`);
			if (Boolean(edition.altSourceUrl) !== Boolean(edition.altSourceLabel)) errors.push(`Edition ${edition.fileKey} must set altSourceUrl and altSourceLabel together`);
		}
	}

	const expectedByFile = new Map();
	for (const source of sourceMetadata.sources) {
		for (const edition of source.editions || []) {
			expectedByFile.set(edition.fileKey, { sourceId: source.id, edition: edition.version });
		}
	}

	for (const [fileKey, chapters] of Object.entries(files)) {
		if (!Object.keys(chapters).length) errors.push(`File ${fileKey} has no chapters`);
		const expected = expectedByFile.get(fileKey);
		if (!expected) errors.push(`File ${fileKey} is missing source metadata`);
		for (const [chapter, perks] of Object.entries(chapters)) {
			if (!Array.isArray(perks)) errors.push(`File ${fileKey}, chapter ${chapter} is not an array`);
			for (const perk of perks) {
				if (!uuidPattern.test(perk.id) || ids.has(perk.id)) errors.push(`Invalid or duplicate perk UUID ${perk.id}`);
				ids.add(perk.id);
				for (const forbidden of ['category', 'source']) {
					if (Object.prototype.hasOwnProperty.call(perk, forbidden)) errors.push(`Perk ${perk.id} must not contain ${forbidden}`);
				}
				if (expected) {
					if (perk.sourceId !== expected.sourceId) errors.push(`Perk ${perk.id} has wrong sourceId ${perk.sourceId} (expected ${expected.sourceId})`);
					if (perk.edition !== expected.edition) errors.push(`Perk ${perk.id} has wrong edition ${perk.edition} (expected ${expected.edition})`);
				}
				const missing = ['sourceId', 'edition', 'chapter', 'name', 'cost', 'description'].filter(key => perk[key] === undefined || perk[key] === null);
				if (missing.length) errors.push(`Invalid perk ${perk.id}: missing ${missing.join(', ')}`);
				if (perk.chapter !== chapter || !perk.name || !perk.description || !Number.isFinite(perk.cost) || perk.cost < 0) errors.push(`Invalid perk ${perk.id}`);
				if (perk.origin !== undefined && (typeof perk.origin !== 'string' || !perk.origin.trim())) errors.push(`Perk ${perk.id} has an invalid origin`);
			}
		}
	}

	for (const fileKey of fileKeys) {
		if (!mappedFileKeys.has(fileKey)) errors.push(`File ${fileKey} is missing source metadata`);
	}
	return errors;
}

function validatePreparedData({ dataset, sources, origins, grouped, items, changedIdCount, reusedOrRetiredIdCount }) {
	const errors = [];
	const ids = new Set();
	const editionsBySource = new Map();
	const fileKeys = new Set(Object.keys(grouped));
	const originIds = new Set(origins.map(origin => origin.id));
	const forbiddenCountFields = ['totalPerks', 'perkCount', 'adultCount', 'categoryCount', 'sourceCount', 'chapterCount'];

	for (const field of ['name', 'datasetVersion']) {
		if (!dataset[field]) errors.push(`Dataset metadata missing ${field}`);
	}
	for (const field of forbiddenCountFields) {
		if (Object.prototype.hasOwnProperty.call(dataset, field)) errors.push(`Dataset metadata contains count field ${field}`);
	}

	for (const source of sources) {
		if (!MACHINE_ID_RE.test(source.id)) errors.push(`Invalid source ID: ${source.id}`);
		if (!source.displayName) errors.push(`Source ${source.id} missing displayName`);
		if (!Array.isArray(source.editions) || !source.editions.length) errors.push(`Source ${source.id} has no editions`);
		const editionVersions = new Set();
		for (const edition of source.editions || []) {
			if (!MACHINE_ID_RE.test(edition.version)) errors.push(`Invalid edition version: ${source.id}:${edition.version}`);
			if (!MACHINE_ID_RE.test(edition.fileKey)) errors.push(`Invalid edition fileKey: ${edition.fileKey}`);
			if (!fileKeys.has(edition.fileKey)) errors.push(`Edition ${source.id}:${edition.version} references missing database ${edition.fileKey}`);
			if (editionVersions.has(edition.version)) errors.push(`Duplicate edition version: ${source.id}:${edition.version}`);
			editionVersions.add(edition.version);
			editionsBySource.set(`${source.id}:${edition.version}`, edition);
		}
		if (!editionVersions.has(source.defaultVersion)) errors.push(`Source ${source.id} defaultVersion is not an edition version`);
	}

	for (const origin of origins) {
		if (!MACHINE_ID_RE.test(origin.id)) errors.push(`Invalid origin ID: ${origin.id}`);
		for (const field of ['name', 'displayName', 'description']) {
			if (!origin[field]) errors.push(`Origin ${origin.id} missing ${field}`);
		}
	}

	for (const item of items) {
		const perk = item.perk;
		if (!MACHINE_ID_RE.test(item.originId)) errors.push(`Invalid item origin ID: ${item.originId}`);
		if (!MACHINE_ID_RE.test(item.chapterKey)) errors.push(`Invalid chapter key: ${item.chapterKey}`);
		if (!MACHINE_ID_RE.test(item.nameKey)) errors.push(`Invalid name key: ${item.nameKey}`);
		if (!originIds.has(item.originId)) errors.push(`Perk ${perk.id} references missing origin ${item.originId}`);
		if (!MACHINE_ID_RE.test(perk.id || '')) errors.push(`Invalid perk ID: ${perk.id}`);
		if (ids.has(perk.id)) errors.push(`Duplicate perk ID: ${perk.id}`);
		ids.add(perk.id);
		if (!Number.isFinite(perk.cost) || perk.cost < 0) {
			errors.push(
				`Perk ${perk.id} has invalid cost: ${perk.cost} ` + `(${item.fileKey}/${item.originId}/${item.chapterKey}/${item.nameKey}, raw: ${JSON.stringify(item.rawCost)})`,
			);
		}
		if (!perk.name) errors.push(`Perk ${perk.id} missing name`);
		if (!perk.description) errors.push(`Perk ${perk.id} missing description`);
		if (!shared.isIntentionalBoundaryName(perk.name)) {
			if (/^[-–—:]+/.test(perk.name)) errors.push(`Perk ${perk.id} name starts with separator punctuation: ${JSON.stringify(perk.name)}`);
			if (/[-–—:]+$/.test(perk.name)) errors.push(`Perk ${perk.id} name ends with separator punctuation: ${JSON.stringify(perk.name)}`);
		}
		if (/^:\s*\n/.test(perk.description)) errors.push(`Perk ${perk.id} description starts with a stray colon`);
		if (!perk.description.trim() || /^[:–—]+$/.test(perk.description.trim())) errors.push(`Perk ${perk.id} description is only separator punctuation`);
		if (!editionsBySource.has(`${perk.sourceId}:${perk.editionVersion}`)) {
			errors.push(`Perk ${perk.id} references missing edition ${perk.sourceId}:${perk.editionVersion}`);
		}
		if (typeof perk.isAdult !== 'boolean') errors.push(`Perk ${perk.id} has non-boolean isAdult`);
		if (!Array.isArray(perk.tags) || perk.tags.some(tag => typeof tag !== 'string')) errors.push(`Perk ${perk.id} has invalid tags`);
	}

	for (const [fileKey, originsById] of Object.entries(grouped)) {
		if (!MACHINE_ID_RE.test(fileKey)) errors.push(`Invalid grouped fileKey: ${fileKey}`);
		for (const [originId, origin] of Object.entries(originsById)) {
			if (!originIds.has(originId)) errors.push(`Grouped origin missing metadata: ${originId}`);
			for (const [chapterKey, chapter] of Object.entries(origin.chapters || {})) {
				if (!MACHINE_ID_RE.test(chapterKey)) errors.push(`Invalid grouped chapter key: ${chapterKey}`);
				for (const [nameKey, perks] of Object.entries(chapter.perks || {})) {
					if (!MACHINE_ID_RE.test(nameKey)) errors.push(`Invalid grouped name key: ${nameKey}`);
					if (!Array.isArray(perks)) errors.push(`Perk group is not an array: ${fileKey}/${originId}/${chapterKey}/${nameKey}`);
				}
			}
		}
	}

	if (changedIdCount) errors.push(`Changed ID count since previous render: ${changedIdCount}`);
	if (reusedOrRetiredIdCount) errors.push(`Reused or retired ID count: ${reusedOrRetiredIdCount}`);

	return errors;
}

module.exports = { validateBackendGeneratorFiles, validatePreparedData };

const { uuidForLogicalKey } = require('./prepare-items');
const { MACHINE_ID_RE, displayNameFromId, sortObjectByKeys } = require('../helpers');

function buildFileEditions(fileKeys, configuredGroups = {}) {
	const fileKeySet = new Set(fileKeys);
	const editionsByFile = new Map();
	const groupedFileKeys = new Set();

	for (const [sourceId, group] of Object.entries(configuredGroups)) {
		if (!MACHINE_ID_RE.test(sourceId) || !group || typeof group !== 'object') throw new Error(`Invalid source edition group ${sourceId}`);
		const editions = Object.entries(group.editions || {});
		if (!editions.length || !editions.some(([version]) => version === group.defaultVersion)) throw new Error(`Source edition group ${sourceId} must include its defaultVersion`);
		for (const [version, fileKey] of editions) {
			if (!MACHINE_ID_RE.test(version) || typeof fileKey !== 'string' || !fileKeySet.has(fileKey)) {
				throw new Error(`Source edition group ${sourceId} maps ${version} to an unknown fileKey`);
			}
			if (groupedFileKeys.has(fileKey)) throw new Error(`FileKey ${fileKey} is mapped to more than one source edition group`);
			groupedFileKeys.add(fileKey);
			editionsByFile.set(fileKey, { sourceId, version, defaultVersion: group.defaultVersion });
		}
	}

	const standaloneVersionFiles = new Map();
	for (const fileKey of fileKeySet) {
		if (groupedFileKeys.has(fileKey)) continue;
		const versionMatch = fileKey.match(/^(.+)_v(\d+)$/);
		if (!versionMatch || fileKeySet.has(versionMatch[1])) continue;
		const versions = standaloneVersionFiles.get(versionMatch[1]) || [];
		versions.push({ fileKey, version: `v${versionMatch[2]}` });
		standaloneVersionFiles.set(versionMatch[1], versions);
	}

	for (const fileKey of fileKeySet) {
		if (editionsByFile.has(fileKey)) continue;
		const versionMatch = fileKey.match(/^(.+)_v(\d+)$/);
		const baseId = versionMatch?.[1];
		const standaloneVersion = baseId && standaloneVersionFiles.get(baseId)?.length === 1 ? `v${versionMatch[2]}` : null;
		const sourceId = standaloneVersion ? baseId : fileKey;
		const version = standaloneVersion || 'default';
		editionsByFile.set(fileKey, { sourceId, version, defaultVersion: standaloneVersion || 'default' });
	}

	return editionsByFile;
}

function buildBackendGeneratorFiles(items, configuredGroups = {}) {
	const fileKeys = new Set();
	for (const item of items) fileKeys.add(item.fileKey);
	const fileEditions = buildFileEditions(fileKeys, configuredGroups);

	const files = {};
	for (const item of items) {
		const { fileKey, chapter } = item;
		const { sourceId, version } = fileEditions.get(fileKey);
		files[fileKey] ||= {};
		files[fileKey][chapter] ||= [];
		files[fileKey][chapter].push({
			id: uuidForLogicalKey(item.logicalKey),
			sourceId,
			edition: version,
			chapter,
			name: item.perk.name,
			cost: item.perk.cost,
			description: item.perk.description,
			origin: item.originName,
		});
	}

	for (const chapters of Object.values(files)) {
		for (const perks of Object.values(chapters)) perks.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
	}

	const sourceMetadata = buildSourceMetadata(files, items, fileEditions);
	return {
		files: sortObjectByKeys(Object.fromEntries(Object.entries(files).map(([fileKey, chapters]) => [fileKey, sortObjectByKeys(chapters)]))),
		sourceMetadata: { schemaVersion: 1, sources: sourceMetadata },
	};
}

function buildSourceMetadata(files, items, fileEditions) {
	const sourcesById = new Map();
	const itemsByFile = new Map();
	for (const item of items) {
		const fileItems = itemsByFile.get(item.fileKey) || [];
		fileItems.push(item);
		itemsByFile.set(item.fileKey, fileItems);
	}

	for (const [fileKey, { sourceId, version, defaultVersion }] of fileEditions) {
		const fileItems = itemsByFile.get(fileKey) || [];
		const existing = sourcesById.get(sourceId);
		const displayName = displayNameFromId(sourceId);
		const source = existing || {
			id: sourceId,
			displayName,
			description: `Perks from ${displayName}.`,
			isMature: false,
			defaultVersion,
			editions: [],
		};
		if (!existing) sourcesById.set(sourceId, source);
		if (source.isMature === false && fileItems.some(item => item.perk.isAdult)) source.isMature = true;
		if (!source.editions.some(edition => edition.version === version)) {
			source.editions.push({ fileKey, version });
		}
	}

	return [...sourcesById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { buildBackendGeneratorFiles, buildFileEditions, buildSourceMetadata };

const { shared } = require('../config/settings');
const { uuidForLogicalKey } = require('./prepare-items');
const { MACHINE_ID_RE, displayNameFromId, sortObjectByKeys } = require('../helpers');

function buildBackendGeneratorFiles(items, sourceGroups = shared.sourceVersions) {
	const files = {};

	for (const item of items) {
		const { database, chapter, sourceName } = item;
		files[database] ||= {};
		files[database][chapter] ||= [];
		files[database][chapter].push({
			id: uuidForLogicalKey(item.logicalKey),
			category: database,
			chapter,
			name: item.perk.name,
			cost: item.perk.cost,
			description: item.perk.description,
			source: sourceName,
		});
	}

	for (const chapters of Object.values(files)) {
		for (const perks of Object.values(chapters)) perks.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
	}

	const sourceMetadata = buildSourceMetadata(files, items, sourceGroups);
	return {
		files: sortObjectByKeys(Object.fromEntries(Object.entries(files).map(([database, chapters]) => [database, sortObjectByKeys(chapters)]))),
		sourceMetadata: { schemaVersion: 1, sources: sourceMetadata },
	};
}

function buildSourceMetadata(files, items, configuredGroups = shared.sourceVersions || {}) {
	const groupedDatabases = new Set();
	const sources = [];
	const itemsByDatabase = new Map();
	for (const item of items) {
		const databaseItems = itemsByDatabase.get(item.database) || [];
		databaseItems.push(item);
		itemsByDatabase.set(item.database, databaseItems);
	}

	for (const [sourceId, group] of Object.entries(configuredGroups)) {
		if (!MACHINE_ID_RE.test(sourceId) || !group || typeof group !== 'object') throw new Error(`Invalid source version group ${sourceId}`);
		const versions = Object.entries(group.versions || {});
		if (!versions.length || !versions.some(([version]) => version === group.defaultVersion)) throw new Error(`Source version group ${sourceId} must include its defaultVersion`);
		for (const [version, database] of versions) {
			if (!MACHINE_ID_RE.test(version) || typeof database !== 'string' || !Object.hasOwn(files, database)) {
				throw new Error(`Source version group ${sourceId} maps ${version} to an unknown database`);
			}
			if (groupedDatabases.has(database)) throw new Error(`Database ${database} is mapped to more than one source version group`);
			groupedDatabases.add(database);
		}
		const groupItems = versions.flatMap(([, database]) => itemsByDatabase.get(database) || []);
		sources.push({
			id: sourceId,
			displayName: group.displayName || displayNameFromId(sourceId),
			description: group.description || `Perks from ${group.displayName || displayNameFromId(sourceId)}.`,
			isR18: groupItems.some(item => item.perk.isAdult),
			defaultVersion: group.defaultVersion,
			categories: versions.map(([version, id]) => ({ id, version })),
		});
	}

	const standaloneVersionDatabases = new Map();
	for (const database of Object.keys(files)) {
		if (groupedDatabases.has(database)) continue;
		const versionMatch = database.match(/^(.+)_v(\d+)$/);
		if (!versionMatch || Object.hasOwn(files, versionMatch[1])) continue;
		const databases = standaloneVersionDatabases.get(versionMatch[1]) || [];
		databases.push({ database, version: `v${versionMatch[2]}` });
		standaloneVersionDatabases.set(versionMatch[1], databases);
	}

	for (const database of Object.keys(files)) {
		if (groupedDatabases.has(database)) continue;
		const databaseItems = itemsByDatabase.get(database) || [];
		const versionMatch = database.match(/^(.+)_v(\d+)$/);
		const baseId = versionMatch?.[1];
		const standaloneVersion = baseId && standaloneVersionDatabases.get(baseId)?.length === 1 ? `v${versionMatch[2]}` : null;
		const sourceId = standaloneVersion ? baseId : database;
		const displayName = standaloneVersion ? displayNameFromId(baseId) : databaseItems[0]?.perk.categoryDisplayName || displayNameFromId(database);
		sources.push({
			id: sourceId,
			displayName,
			description: `Perks from ${displayName}.`,
			isR18: databaseItems.some(item => item.perk.isAdult),
			defaultVersion: standaloneVersion || 'default',
			categories: [{ id: database, version: standaloneVersion || 'default' }],
		});
	}

	return sources.sort((left, right) => left.id.localeCompare(right.id));
}

module.exports = { buildBackendGeneratorFiles, buildSourceMetadata };
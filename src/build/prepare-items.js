const crypto = require('crypto');
const {
	requireMachineId,
	sourceNameForRow,
	normalizeCost,
	normalizeTags,
	isAdultRow,
	logicalIdentityForRow,
	sortObjectByKeys,
} = require('../helpers');

function prepareItems(databases) {
	const categoriesById = new Map();
	const sourceMetadataById = new Map();
	const items = [];

	for (const db of [...databases.values()].sort((a, b) => a.database.localeCompare(b.database))) {
		const category = categoriesById.get(db.categoryId) || {
			id: db.categoryId,
			displayName: db.categoryDisplayName,
			defaultVersion: 'default',
			versions: [],
		};
		if (!category.versions.some(version => version.id === db.versionId)) {
			category.versions.push({
				id: db.versionId,
				displayName: db.versionDisplayName,
				database: db.database,
			});
		}
		if (!category.versions.some(version => version.id === category.defaultVersion)) category.defaultVersion = db.versionId;
		categoriesById.set(db.categoryId, category);

		for (const row of db.rows) {
			const sourceName = sourceNameForRow(row, db.categoryDisplayName);
			const sourceId = `source_${requireMachineId(sourceName)}`;
			const chapter = String(row.chapter || 'Uncategorized').trim();
			const chapterKey = requireMachineId(chapter);
			const name = String(row.name || '').trim();
			const nameKey = requireMachineId(name);
			const description = String(row.description || '').trim();
			const sourceMetadata = sourceMetadataById.get(sourceId) || {
				id: sourceId,
				name: sourceName,
				displayName: sourceName,
				description: `Perks from ${sourceName}.`,
				categories: [],
			};
			if (!sourceMetadata.categories.includes(db.categoryId)) sourceMetadata.categories.push(db.categoryId);
			sourceMetadataById.set(sourceId, sourceMetadata);

			const perk = {
				id: null,
				cost: normalizeCost(row.cost),
				name,
				description,
				category: db.categoryId,
				categoryVersion: db.versionId,
				categoryDisplayName: db.versionDisplayName,
				tags: normalizeTags(row.tags),
				isAdult: isAdultRow(row, db.database),
			};

			items.push({
				database: db.database,
				sourceId,
				sourceName,
				sourceDescription: sourceMetadata.description,
				chapterKey,
				chapter,
				nameKey,
				rawCost: row.cost,
				logicalKey: logicalIdentityForRow(row, db.database),
				perk,
			});
		}
	}

	for (const category of categoriesById.values()) {
		category.versions.sort((a, b) => a.id.localeCompare(b.id));
	}
	for (const source of sourceMetadataById.values()) {
		source.categories.sort((a, b) => a.localeCompare(b));
	}

	items.sort(
		(a, b) =>
			a.perk.category.localeCompare(b.perk.category) ||
			a.perk.categoryVersion.localeCompare(b.perk.categoryVersion) ||
			a.sourceId.localeCompare(b.sourceId) ||
			a.chapterKey.localeCompare(b.chapterKey) ||
			a.nameKey.localeCompare(b.nameKey) ||
			a.logicalKey.localeCompare(b.logicalKey),
	);

	return {
		categories: [...categoriesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
		sources: [...sourceMetadataById.values()].sort((a, b) => a.id.localeCompare(b.id)),
		items,
	};
}

function buildPerkDatabases(items) {
	const grouped = {};

	for (const item of items) {
		grouped[item.database] ||= {};
		grouped[item.database][item.sourceId] ||= {
			source: item.sourceName,
			description: item.sourceDescription,
			chapters: {},
		};
		const source = grouped[item.database][item.sourceId];
		source.chapters[item.chapterKey] ||= {
			chapter: item.chapter,
			perks: {},
		};
		const chapter = source.chapters[item.chapterKey];
		chapter.perks[item.nameKey] ||= [];
		chapter.perks[item.nameKey].push(item.perk);
	}

	for (const database of Object.keys(grouped)) {
		grouped[database] = sortObjectByKeys(grouped[database]);
		for (const source of Object.values(grouped[database])) {
			source.chapters = sortObjectByKeys(source.chapters);
			for (const chapter of Object.values(source.chapters)) {
				chapter.perks = sortObjectByKeys(chapter.perks);
				for (const perks of Object.values(chapter.perks)) {
					perks.sort((a, b) => a.id.localeCompare(b.id));
				}
			}
		}
	}

	return grouped;
}

function uuidForLogicalKey(logicalKey) {
	const bytes = crypto.createHash('sha1').update(`celestial-gambler/${logicalKey}`).digest().subarray(0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function disambiguateLogicalKeys(items) {
	const occurrences = new Map();
	for (const item of items) {
		const occurrence = occurrences.get(item.logicalKey) || 0;
		occurrences.set(item.logicalKey, occurrence + 1);
		if (occurrence) item.logicalKey = `${item.logicalKey}/occurrence_${occurrence + 1}`;
	}
}

module.exports = { prepareItems, buildPerkDatabases, uuidForLogicalKey, disambiguateLogicalKeys };
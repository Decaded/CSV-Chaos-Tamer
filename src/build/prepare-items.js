const crypto = require('crypto');
const {
	requireMachineId,
	originNameForRow,
	normalizeCost,
	normalizeTags,
	isAdultRow,
	logicalIdentityForRow,
	sortObjectByKeys,
} = require('../helpers');

function prepareItems(databases) {
	const sourcesById = new Map();
	const originsById = new Map();
	const items = [];

	for (const db of [...databases.values()].sort((a, b) => a.fileKey.localeCompare(b.fileKey))) {
		const source = sourcesById.get(db.sourceId) || {
			id: db.sourceId,
			displayName: db.sourceDisplayName,
			defaultVersion: 'default',
			editions: [],
		};
		if (!source.editions.some(edition => edition.version === db.editionVersion)) {
			source.editions.push({
				version: db.editionVersion,
				displayName: db.editionDisplayName,
				fileKey: db.fileKey,
			});
		}
		if (!source.editions.some(edition => edition.version === source.defaultVersion)) source.defaultVersion = db.editionVersion;
		sourcesById.set(db.sourceId, source);

		for (const row of db.rows) {
			const originName = originNameForRow(row, db.sourceDisplayName);
			const originId = `origin_${requireMachineId(originName)}`;
			const chapter = String(row.chapter || 'Uncategorized').trim();
			const chapterKey = requireMachineId(chapter);
			const name = String(row.name || '').trim();
			const nameKey = requireMachineId(name);
			const description = String(row.description || '').trim();
			const origin = originsById.get(originId) || {
				id: originId,
				name: originName,
				displayName: originName,
				description: `Perks from ${originName}.`,
			};
			originsById.set(originId, origin);

			const perk = {
				id: null,
				cost: normalizeCost(row.cost),
				name,
				description,
				sourceId: db.sourceId,
				editionVersion: db.editionVersion,
				editionDisplayName: db.editionDisplayName,
				tags: normalizeTags(row.tags),
				isAdult: isAdultRow(row, db.fileKey),
			};

			items.push({
				fileKey: db.fileKey,
				originId,
				originName,
				originDescription: origin.description,
				chapterKey,
				chapter,
				nameKey,
				rawCost: row.cost,
				logicalKey: logicalIdentityForRow(row, db.fileKey),
				perk,
			});
		}
	}

	for (const source of sourcesById.values()) {
		source.editions.sort((a, b) => a.version.localeCompare(b.version));
	}

	items.sort(
		(a, b) =>
			a.perk.sourceId.localeCompare(b.perk.sourceId) ||
			a.perk.editionVersion.localeCompare(b.perk.editionVersion) ||
			a.originId.localeCompare(b.originId) ||
			a.chapterKey.localeCompare(b.chapterKey) ||
			a.nameKey.localeCompare(b.nameKey) ||
			a.logicalKey.localeCompare(b.logicalKey),
	);

	return {
		sources: [...sourcesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
		origins: [...originsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
		items,
	};
}

function buildPerkDatabases(items) {
	const grouped = {};

	for (const item of items) {
		grouped[item.fileKey] ||= {};
		grouped[item.fileKey][item.originId] ||= {
			origin: item.originName,
			chapters: {},
		};
		const origin = grouped[item.fileKey][item.originId];
		origin.chapters[item.chapterKey] ||= {
			chapter: item.chapter,
			perks: {},
		};
		const chapter = origin.chapters[item.chapterKey];
		chapter.perks[item.nameKey] ||= [];
		chapter.perks[item.nameKey].push(item.perk);
	}

	for (const fileKey of Object.keys(grouped)) {
		grouped[fileKey] = sortObjectByKeys(grouped[fileKey]);
		for (const origin of Object.values(grouped[fileKey])) {
			origin.chapters = sortObjectByKeys(origin.chapters);
			for (const chapter of Object.values(origin.chapters)) {
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
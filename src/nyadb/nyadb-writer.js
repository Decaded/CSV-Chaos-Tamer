function listFromPayload(payload, key) {
	if (Array.isArray(payload)) return payload;
	if (!payload || typeof payload !== 'object') return [];
	const value = key ? payload[key] : payload;
	if (Array.isArray(value)) return value;
	if (value && typeof value === 'object') return Object.values(value);
	return [];
}

function deepEqual(a, b) {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]));
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	return aKeys.length === bKeys.length && aKeys.every(key => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

function deepCopy(value) {
	return JSON.parse(JSON.stringify(value));
}

function mergeCategoryPayload(existingPayload, incomingPayload) {
	const existing = listFromPayload(existingPayload, 'categories');
	const incoming = listFromPayload(incomingPayload, 'categories');
	const byId = new Map();

	for (const category of existing) {
		if (!category?.id) continue;
		const versions = new Map((category.versions || []).filter(v => v?.id).map(v => [v.id, { ...v }]));
		byId.set(category.id, {
			...category,
			versions,
		});
	}

	for (const category of incoming) {
		if (!category?.id) continue;
		const current = byId.get(category.id) || { id: category.id, versions: new Map() };
		const merged = {
			...current,
			...category,
			versions: current.versions,
		};
		for (const version of category.versions || []) {
			if (!version?.id) continue;
			merged.versions.set(version.id, { ...(merged.versions.get(version.id) || {}), ...version });
		}
		byId.set(category.id, merged);
	}

	const categories = [...byId.values()]
		.map(category => ({
			...category,
			versions: [...category.versions.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
		}))
		.sort((a, b) => String(a.id).localeCompare(String(b.id)));

	return { categories };
}

function mergeSourcePayload(existingPayload, incomingPayload) {
	const existing = listFromPayload(existingPayload, 'sources');
	const incoming = listFromPayload(incomingPayload, 'sources');
	const byId = new Map();

	for (const source of existing) {
		if (!source?.id) continue;
		byId.set(source.id, {
			...source,
			categories: [...new Set((source.categories || []).map(String))].sort((a, b) => a.localeCompare(b)),
		});
	}

	for (const source of incoming) {
		if (!source?.id) continue;
		const current = byId.get(source.id) || {};
		const categories = [...new Set([...(current.categories || []), ...(source.categories || [])].map(String))].sort((a, b) => a.localeCompare(b));
		byId.set(source.id, {
			...current,
			...source,
			categories,
		});
	}

	return {
		sources: [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
	};
}

function mergeNyaDbContents(name, existingContents, incomingContents) {
	if (!existingContents || typeof existingContents !== 'object') return incomingContents;
	if (name === 'dataset') return { ...existingContents, ...(incomingContents || {}) };
	if (name === 'categories') return mergeCategoryPayload(existingContents, incomingContents);
	if (name === 'sources') return mergeSourcePayload(existingContents, incomingContents);
	return { ...existingContents, ...(incomingContents || {}) };
}

function writeNyaDbDatabases({ files, sourceMetadata }, logger = console, options = {}) {
	const mergeExisting = options.mergeExisting === true;
	const NyaDB = require('@decaded/nyadb');
	const nyadb = new NyaDB({
		formattingStyle: 'space',
		indentSize: 2,
		writeDebounce: 0,
		maxFileSize: 1024,
	});
	const databases = {
		generatorSources: Object.fromEntries(sourceMetadata.sources.map(source => [source.id, source])),
	};
	for (const [category, chapters] of Object.entries(files)) {
		databases[`perks_${category}`] = Object.fromEntries(
			Object.values(chapters)
				.flat()
				.map(perk => [perk.id, perk]),
		);
	}

	const deleted = [];
	if (!mergeExisting) {
		for (const name of nyadb.getList()) {
			if (!Object.hasOwn(databases, name)) {
				nyadb.delete(name);
				deleted.push(name);
				logger.log(`Removed database "${name}"`);
			}
		}
	}

	const changed = [];
	const unchanged = [];
	for (const [name, contents] of Object.entries(databases).sort(([a], [b]) => a.localeCompare(b))) {
		const exists = nyadb.exists(name);
		const current = exists ? deepCopy(nyadb.get(name)) : null;
		const nextContents = mergeExisting ? mergeNyaDbContents(name, current, contents) : contents;
		if (exists && deepEqual(current, nextContents)) {
			unchanged.push(name);
			continue;
		}
		if (!exists) nyadb.create(name);
		if (!nyadb.set(name, deepCopy(nextContents))) throw new Error(`Failed to write database "${name}"`);
		changed.push(name);
		logger.log(`Stored database "${name}"`);
	}

	return { changed, unchanged, deleted };
}

module.exports = { mergeNyaDbContents, writeNyaDbDatabases };
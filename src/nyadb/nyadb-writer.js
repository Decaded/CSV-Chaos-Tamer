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

/** Yield to the event loop so streaming log output (e.g. the web panel console) can flush between disk writes. */
function yieldToEventLoop() {
	return new Promise(resolve => setImmediate(resolve));
}

async function writeNyaDbDatabases({ files, sourceMetadata }, logger = console) {
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
	for (const [fileKey, chapters] of Object.entries(files)) {
		databases[`perks_${fileKey}`] = Object.fromEntries(
			Object.values(chapters)
				.flat()
				.map(perk => [perk.id, perk]),
		);
	}

	const deleted = [];
	for (const name of nyadb.getList()) {
		if (!Object.hasOwn(databases, name)) {
			nyadb.delete(name);
			deleted.push(name);
			logger.log(`Removed database "${name}"`);
		}
		await yieldToEventLoop();
	}

	const changed = [];
	const unchanged = [];
	for (const [name, contents] of Object.entries(databases).sort(([a], [b]) => a.localeCompare(b))) {
		const exists = nyadb.exists(name);
		const current = exists ? deepCopy(nyadb.get(name)) : null;
		if (exists && deepEqual(current, contents)) {
			unchanged.push(name);
		} else {
			if (!exists) nyadb.create(name);
			if (!nyadb.set(name, deepCopy(contents))) throw new Error(`Failed to write database "${name}"`);
			changed.push(name);
			logger.log(`Stored database "${name}"`);
		}
		await yieldToEventLoop();
	}

	return { changed, unchanged, deleted };
}

module.exports = { writeNyaDbDatabases };
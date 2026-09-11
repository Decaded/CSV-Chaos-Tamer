const fs = require('fs');
const path = require('path');

const ID_REGISTRY_PATH = path.join(__dirname, 'perk-id-registry.json');

function emptyRegistry() {
	return {
		version: 1,
		nextNumericId: 1,
		active: {},
		retired: {},
	};
}

function loadRegistry(registryPath = ID_REGISTRY_PATH) {
	if (!fs.existsSync(registryPath)) return emptyRegistry();
	const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
	return {
		...emptyRegistry(),
		...registry,
		active: registry.active || {},
		retired: registry.retired || {},
	};
}

function nextPerkId(registry, usedIds) {
	while (usedIds.has(`perk_${String(registry.nextNumericId).padStart(6, '0')}`)) {
		registry.nextNumericId += 1;
	}
	const id = `perk_${String(registry.nextNumericId).padStart(6, '0')}`;
	registry.nextNumericId += 1;
	return id;
}

function assignPerkIds(items, registry) {
	const usedIds = new Set([...Object.values(registry.active), ...Object.values(registry.retired)]);
	const activeIds = new Set(Object.values(registry.active));
	const seenKeys = new Map();
	let changedIdCount = 0;
	let reusedOrRetiredIdCount = 0;

	for (const item of items) {
		let logicalKey = item.logicalKey;
		const duplicateCount = seenKeys.get(logicalKey) || 0;
		seenKeys.set(logicalKey, duplicateCount + 1);
		if (duplicateCount) logicalKey = `${logicalKey}/occurrence_${duplicateCount + 1}`;
		item.logicalKey = logicalKey;

		if (registry.retired[logicalKey]) {
			item.perk.id = nextPerkId(registry, usedIds);
			usedIds.add(item.perk.id);
			delete registry.retired[logicalKey];
			registry.active[logicalKey] = item.perk.id;
			reusedOrRetiredIdCount += 1;
			continue;
		}

		if (registry.active[logicalKey]) {
			item.perk.id = registry.active[logicalKey];
			if (usedIds.has(item.perk.id) && !activeIds.has(item.perk.id)) changedIdCount += 1;
			continue;
		}

		item.perk.id = nextPerkId(registry, usedIds);
		usedIds.add(item.perk.id);
		registry.active[logicalKey] = item.perk.id;
	}

	return { changedIdCount, reusedOrRetiredIdCount };
}

function retireMissingRegistryKeys(registry, currentKeys) {
	for (const [logicalKey, id] of Object.entries(registry.active)) {
		if (currentKeys.has(logicalKey)) continue;
		registry.retired[logicalKey] = id;
		delete registry.active[logicalKey];
	}
}

module.exports = {
	ID_REGISTRY_PATH,
	emptyRegistry,
	loadRegistry,
	nextPerkId,
	assignPerkIds,
	retireMissingRegistryKeys,
};
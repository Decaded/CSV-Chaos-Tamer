const assert = require('assert');
const {
	assignPerkIds,
	buildPerkDatabases,
	collectSplitRows,
	deriveCategoryVersion,
	deriveSplitCategory,
	extractChapterFromFilename,
	normalizeCost,
	normalizeHeader,
	prepareItems,
	mergeNyaDbContents,
	validatePreparedData,
} = require('../index');

function test(name, fn) {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (err) {
		console.error(`not ok - ${name}`);
		throw err;
	}
}

test('normalizeHeader lowercases and removes non-letters', () => {
	assert.strictEqual(normalizeHeader('CP Cost'), 'cpcost');
	assert.strictEqual(normalizeHeader('Unnamed: 0'), 'unnamed');
});

test('extractChapterFromFilename strips common noise', () => {
	assert.strictEqual(extractChapterFromFilename('Copy - Items.csv'), 'Items');
});

test('collectSplitRows aggregates split chapters and removes them from database', () => {
	const database = {
		1: [
			{ name: 'Keep me', chapter: 'Main' },
			{ name: 'Split waifu', chapter: 'Waifu Catalogue' },
		],
		2: [{ name: 'Split lewd', chapter: 'Lewd' }],
	};
	const splitBuckets = {};

	collectSplitRows(database, splitBuckets);

	assert.deepStrictEqual(Object.keys(splitBuckets).sort(), ['companion_lewd', 'waifu']);
	assert.strictEqual(splitBuckets.waifu.length, 1);
	assert.strictEqual(splitBuckets.companion_lewd.length, 1);
	assert.deepStrictEqual(database, {
		1: [{ name: 'Keep me', chapter: 'Main' }],
		2: [],
	});
});

test('deriveCategoryVersion groups trailing v-number folders as category versions', () => {
	assert.deepStrictEqual(deriveCategoryVersion('Grimoire v6'), {
		categoryId: 'grimoire',
		categoryDisplayName: 'Grimoire',
		versionId: 'v6',
		versionDisplayName: 'Grimoire V6',
		database: 'grimoire_v6',
	});
	assert.deepStrictEqual(deriveSplitCategory('companion_lewd'), {
		categoryId: 'companion_lewd',
		categoryDisplayName: 'Companion Lewd',
		versionId: 'default',
		versionDisplayName: 'Companion Lewd',
		database: 'companion_lewd',
	});
});

test('normalizeCost emits finite non-negative numbers', () => {
	assert.strictEqual(normalizeCost('Free'), 0);
	assert.strictEqual(normalizeCost('Free for All'), 0);
	assert.strictEqual(normalizeCost('Variable CP'), 0);
	assert.strictEqual(normalizeCost('-300CP'), 300);
	assert.strictEqual(normalizeCost(25), 25);
});

test('prepareItems and buildPerkDatabases create source chapter name hierarchy', () => {
	const databases = new Map([
		[
			'grimoire_v2',
			{
				categoryId: 'grimoire',
				categoryDisplayName: 'Grimoire',
				versionId: 'v2',
				versionDisplayName: 'Grimoire V2',
				database: 'grimoire_v2',
				rows: [
					{
						__source: 'Sample Sheet',
						__line: 1,
						id: 10,
						cost: '100CP',
						name: 'Arcane Tuning',
						source: 'Fate/Grand Master',
						chapter: 'Parameters',
						description: 'Tune the spell to optimize power delivery.',
					},
				],
			},
		],
	]);
	const prepared = prepareItems(databases);
	prepared.items[0].perk.id = 'perk_000001';
	const grouped = buildPerkDatabases(prepared.items);
	const errors = validatePreparedData({
		dataset: { name: 'Dataset', datasetVersion: '1' },
		...prepared,
		grouped,
		changedIdCount: 0,
		reusedOrRetiredIdCount: 0,
	});

	assert.deepStrictEqual(errors, []);
	assert.strictEqual(grouped.grimoire_v2.source_fate_grand_master.chapters.parameters.perks.arcane_tuning[0].categoryVersion, 'v2');
});

test('mergeNyaDbContents upserts category versions by category id and version id', () => {
	const existing = {
		categories: [
			{
				id: 'grimoire',
				displayName: 'Grimoire',
				defaultVersion: 'default',
				versions: [{ id: 'default', displayName: 'Grimoire', database: 'grimoire' }],
			},
		],
	};
	const incoming = {
		categories: [
			{
				id: 'grimoire',
				displayName: 'Grimoire',
				defaultVersion: 'v2',
				versions: [{ id: 'v2', displayName: 'Grimoire V2', database: 'grimoire_v2' }],
			},
			{
				id: 'forge',
				displayName: 'Forge',
				defaultVersion: 'default',
				versions: [{ id: 'default', displayName: 'Forge', database: 'forge' }],
			},
		],
	};

	const merged = mergeNyaDbContents('categories', existing, incoming);
	assert.strictEqual(merged.categories.length, 2);
	const grimoire = merged.categories.find(category => category.id === 'grimoire');
	assert.strictEqual(grimoire.defaultVersion, 'v2');
	assert.deepStrictEqual(
		grimoire.versions.map(version => version.id),
		['default', 'v2'],
	);
});

test('mergeNyaDbContents upserts sources and unions source categories', () => {
	const existing = {
		sources: [
			{
				id: 'source_test',
				name: 'Test',
				displayName: 'Test',
				description: 'Old',
				categories: ['grimoire'],
			},
		],
	};
	const incoming = {
		sources: [
			{
				id: 'source_test',
				name: 'Test',
				displayName: 'Test',
				description: 'New',
				categories: ['forge'],
			},
		],
	};

	const merged = mergeNyaDbContents('sources', existing, incoming);
	assert.strictEqual(merged.sources.length, 1);
	assert.strictEqual(merged.sources[0].description, 'New');
	assert.deepStrictEqual(merged.sources[0].categories, ['forge', 'grimoire']);
});

test('mergeNyaDbContents upserts perk database without removing unrelated sources', () => {
	const existing = {
		source_old: {
			source: 'Old Source',
			description: 'Old',
			chapters: {
				old_chapter: {
					chapter: 'Old Chapter',
					perks: {
						old_perk: [{ id: 'perk_000001', name: 'Old', description: 'Old', cost: 100 }],
					},
				},
			},
		},
	};
	const incoming = {
		source_new: {
			source: 'New Source',
			description: 'New',
			chapters: {
				new_chapter: {
					chapter: 'New Chapter',
					perks: {
						new_perk: [{ id: 'perk_000002', name: 'New', description: 'New', cost: 200 }],
					},
				},
			},
		},
	};

	const merged = mergeNyaDbContents('grimoire', existing, incoming);
	assert.ok(merged.source_old);
	assert.ok(merged.source_new);
	assert.ok(merged.source_old.chapters.old_chapter);
	assert.ok(merged.source_new.chapters.new_chapter);
});

test('assignPerkIds assigns fresh id for retired logical key', () => {
	const registry = {
		version: 1,
		nextNumericId: 3,
		active: {},
		retired: {
			'demo/source/id_1': 'perk_000002',
		},
	};
	const items = [
		{
			logicalKey: 'demo/source/id_1',
			perk: { id: null },
		},
	];

	const stats = assignPerkIds(items, registry);

	assert.strictEqual(items[0].perk.id, 'perk_000003');
	assert.strictEqual(registry.active['demo/source/id_1'], 'perk_000003');
	assert.strictEqual(registry.retired['demo/source/id_1'], undefined);
	assert.strictEqual(stats.reusedOrRetiredIdCount, 0);
});

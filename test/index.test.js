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
	buildBackendGeneratorFiles,
	buildSourceMetadata,
	disambiguateLogicalKeys,
	mergeNyaDbContents,
	validatePreparedData,
	validateBackendGeneratorFiles,
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

test('buildBackendGeneratorFiles produces importer-compatible category files and source metadata', () => {
	const prepared = prepareItems(
		new Map([
			[
				'forge',
				{
					categoryId: 'forge',
					categoryDisplayName: 'Forge',
					versionId: 'default',
					versionDisplayName: 'Forge',
					database: 'forge',
					rows: [{ __source: 'Forge Sheet', __line: 1, name: 'Hammer Time', cost: 200, source: 'The Forge', chapter: 'Tools', description: 'Make tools.' }],
				},
			],
		]),
	);
	const output = buildBackendGeneratorFiles(prepared.items, {});

	assert.deepStrictEqual(validateBackendGeneratorFiles(output), []);
	assert.strictEqual(output.sourceMetadata.schemaVersion, 1);
	assert.strictEqual(output.sourceMetadata.sources[0].id, 'forge');
	assert.strictEqual(output.sourceMetadata.sources[0].defaultVersion, 'default');
	assert.match(output.files.forge.Tools[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
	assert.strictEqual(output.files.forge.Tools[0].source, 'The Forge');
});

test('buildBackendGeneratorFiles keeps UUIDs stable across regenerations', () => {
	const items = [
		{
			database: 'forge',
			chapter: 'Tools',
			sourceName: 'The Forge',
			logicalKey: 'forge/forge_sheet/id_1',
			perk: { name: 'Hammer Time', cost: 200, description: 'Make tools.' },
		},
		{
			database: 'forge',
			chapter: 'Tools',
			sourceName: 'The Forge',
			logicalKey: 'forge/forge_sheet/id_2',
			perk: { name: 'Anvil Time', cost: 300, description: 'Make heavier tools.' },
		},
	];
	const firstBuild = buildBackendGeneratorFiles(items, {});
	const secondBuild = buildBackendGeneratorFiles([...items].reverse(), {});
	const idsByName = build => Object.fromEntries(build.files.forge.Tools.map(perk => [perk.name, perk.id]));

	assert.deepStrictEqual(idsByName(secondBuild), idsByName(firstBuild));
});

test('buildSourceMetadata groups configured physical databases as source versions', () => {
	const files = { grimoire: { Main: [] }, grimoire_v2: { Main: [] }, forge: { Tools: [] } };
	const items = [
		{ database: 'grimoire', perk: { categoryDisplayName: 'Grimoire', isAdult: false } },
		{ database: 'grimoire_v2', perk: { categoryDisplayName: 'Grimoire V2', isAdult: false } },
		{ database: 'forge', perk: { categoryDisplayName: 'Forge', isAdult: false } },
	];
	const sources = buildSourceMetadata(files, items, {
		grimoire: {
			displayName: 'Grimoire',
			defaultVersion: 'default',
			versions: { default: 'grimoire', v2: 'grimoire_v2' },
		},
	});
	const grimoire = sources.find(source => source.id === 'grimoire');

	assert.strictEqual(grimoire.defaultVersion, 'default');
	assert.deepStrictEqual(grimoire.categories.slice(0, 2), [
		{ id: 'grimoire', version: 'default' },
		{ id: 'grimoire_v2', version: 'v2' },
	]);
	assert.ok(sources.some(source => source.id === 'forge'));
});

test('buildSourceMetadata groups a standalone versioned database under its base source', () => {
	const files = { song_v2: { Main: [] } };
	const items = [{ database: 'song_v2', perk: { categoryDisplayName: 'Song V2', isAdult: false } }];
	const sources = buildSourceMetadata(files, items, {});

	assert.deepStrictEqual(sources, [
		{
			id: 'song',
			displayName: 'Song',
			description: 'Perks from Song.',
			isR18: false,
			defaultVersion: 'v2',
			categories: [{ id: 'song_v2', version: 'v2' }],
		},
	]);
});

test('disambiguateLogicalKeys gives repeated source rows distinct UUID identities', () => {
	const items = [{ logicalKey: 'example/sheet/id_1' }, { logicalKey: 'example/sheet/id_1' }];
	disambiguateLogicalKeys(items);
	assert.deepStrictEqual(
		items.map(item => item.logicalKey),
		['example/sheet/id_1', 'example/sheet/id_1/occurrence_2'],
	);
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

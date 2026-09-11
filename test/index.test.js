const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, testAsync } = require('./summary');
const {
	assignPerkIds,
	buildDatabase,
	buildPerkDatabases,
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
	validateSourceMetadataConfig,
	applySourceMetadataOverrides,
	parseCsv,
} = require('../src/index');

test('normalizeHeader lowercases and removes non-letters', () => {
	assert.strictEqual(normalizeHeader('CP Cost'), 'cpcost');
	assert.strictEqual(normalizeHeader('Unnamed: 0'), 'unnamed');
});

testAsync('parseCsv maps a combined Perk/Item header to the name field', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-perkitem-'));
	const filePath = path.join(dir, 'Farmland.csv');
	await fs.promises.writeFile(
		filePath,
		['Setting,Perk/Item,Description,Price', 'A Brothers Price,Farm,Well built farmland.,200'].join('\n'),
		'utf8',
	);
	const { rows, maxCP } = await parseCsv(filePath);
	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].name, 'Farm');
	assert.strictEqual(rows[0].description, 'Well built farmland.');
	assert.strictEqual(rows[0].cost, 200);
	assert.strictEqual(maxCP, 200);
});

testAsync('parseCsv maps a plain Perk header to the name field', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-perk-'));
	const filePath = path.join(dir, 'Powers.csv');
	await fs.promises.writeFile(
		filePath,
		['Perk,Cost,Chapter Unlocked ,Jump/Supplement,Category,Effect', 'Technical Training,100 CP,,007,Knowledge,"Not everyone knows how."'].join('\n'),
		'utf8',
	);
	const { rows, maxCP } = await parseCsv(filePath);
	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].name, 'Technical Training');
	assert.strictEqual(rows[0].description, 'Not everyone knows how.');
	assert.strictEqual(rows[0].source, '007');
	assert.strictEqual(rows[0].cost, 100);
	assert.strictEqual(maxCP, 100);
});

testAsync('parseCsv falls back to the first column as name when no name header exists', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-namefallback-'));
	const filePath = path.join(dir, 'Power Armor.csv');
	await fs.promises.writeFile(
		filePath,
		['Power Armor Upgrade,Cost,Chapter Unlocked ,Jump/Supplement,Category,Effect', 'Life Support,Freebee,,Metroid,Base OPA Upgrade,"Sealed environment."'].join('\n'),
		'utf8',
	);
	const { rows } = await parseCsv(filePath);
	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].name, 'Life Support');
	assert.strictEqual(rows[0].description, 'Sealed environment.');
	assert.strictEqual(rows[0].source, 'Metroid');
	assert.strictEqual(rows[0].cost, 0);
});

test('extractChapterFromFilename strips common noise', () => {
	assert.strictEqual(extractChapterFromFilename('Copy - Items.csv'), 'Items');
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
	assert.strictEqual(stats.reusedOrRetiredIdCount, 1);
});

test('assignPerkIds preserves existing active ids and skips counting them as changed', () => {
	const registry = {
		version: 1,
		nextNumericId: 1,
		active: { 'demo/source/id_1': 'perk_000007' },
		retired: {},
	};
	const items = [{ logicalKey: 'demo/source/id_1', perk: { id: null } }];

	const stats = assignPerkIds(items, registry);

	assert.strictEqual(items[0].perk.id, 'perk_000007');
	assert.strictEqual(stats.changedIdCount, 0);
	assert.strictEqual(stats.reusedOrRetiredIdCount, 0);
});

testAsync('buildDatabase writes a persistent perk ID registry and keeps ids stable across runs', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-registry-'));
	const sheetsRoot = path.join(dir, 'sheets');
	const registryPath = path.join(dir, 'perk-id-registry.json');
	const configPath = path.join(dir, 'source-metadata.config.json');

	await fs.promises.mkdir(path.join(sheetsRoot, 'forge'), { recursive: true });
	await fs.promises.writeFile(
		path.join(sheetsRoot, 'forge', 'Forge.csv'),
		['Name,Cost,Source,Description', 'Hammer Time,200,The Forge,Make tools.', 'Anvil Time,300,The Forge,Make heavier tools.'].join('\n'),
		'utf8',
	);
	await fs.promises.writeFile(configPath, JSON.stringify({ forge: { description: 'Crafting perks.', sourceUrl: 'https://example.com' } }), 'utf8');

	const options = { sheetsRoot, registryPath, sourceMetadataConfigPath: configPath, sourceGroups: {}, writeNyaDb: false, logger: { log() {}, warn() {}, error() {} } };

	const first = await buildDatabase(options);
	assert.strictEqual(first.report.perkCount, 2);
	assert.deepStrictEqual(first.databases, ['forge']);
	assert.strictEqual(first.report.duplicateIdCount, 0);
	const firstIds = JSON.parse(await fs.promises.readFile(registryPath, 'utf8')).active;

	const second = await buildDatabase(options);
	const secondIds = JSON.parse(await fs.promises.readFile(registryPath, 'utf8')).active;
	assert.deepStrictEqual(secondIds, firstIds);
	assert.strictEqual(second.report.perkCount, 2);
	assert.strictEqual(second.report.changedIdCountSincePreviousRender, 0);
});

test('validateSourceMetadataConfig flags sources missing a manual entry', () => {
	const errors = validateSourceMetadataConfig([{ id: 'grimoire' }], {});
	assert.ok(errors.some(err => err.includes('grimoire') && err.includes('missing')));
});

test('validateSourceMetadataConfig flags manual entries with no matching source', () => {
	const errors = validateSourceMetadataConfig([], { orphan: { description: 'd', sourceUrl: 'https://example.com' } });
	assert.ok(errors.some(err => err.includes('orphan') && err.includes('unknown source')));
});

test('validateSourceMetadataConfig requires non-empty description and sourceUrl', () => {
	const errors = validateSourceMetadataConfig([{ id: 'grimoire' }], { grimoire: { description: '', sourceUrl: '' } });
	assert.ok(errors.some(err => err.includes('description')));
	assert.ok(errors.some(err => err.includes('sourceUrl')));
});

test('validateSourceMetadataConfig requires altSourceUrl and altSourceLabel together', () => {
	const errors = validateSourceMetadataConfig([{ id: 'grimoire' }], {
		grimoire: { description: 'd', sourceUrl: 'https://example.com', altSourceUrl: 'https://alt.example.com' },
	});
	assert.ok(errors.some(err => err.includes('altSourceUrl') && err.includes('altSourceLabel')));
});

test('validateSourceMetadataConfig passes for a fully matched, valid config', () => {
	const errors = validateSourceMetadataConfig([{ id: 'grimoire' }], { grimoire: { description: 'd', sourceUrl: 'https://example.com' } });
	assert.deepStrictEqual(errors, []);
});

test('applySourceMetadataOverrides replaces description and adds sourceUrl', () => {
	const sources = [{ id: 'grimoire', description: 'Perks from Grimoire.' }];
	applySourceMetadataOverrides(sources, { grimoire: { description: 'Magical abilities and powers.', sourceUrl: 'https://example.com' } });
	assert.strictEqual(sources[0].description, 'Magical abilities and powers.');
	assert.strictEqual(sources[0].sourceUrl, 'https://example.com');
});

test('applySourceMetadataOverrides leaves sources without a manual entry untouched', () => {
	const sources = [{ id: 'grimoire', description: 'Perks from Grimoire.' }];
	applySourceMetadataOverrides(sources, {});
	assert.strictEqual(sources[0].description, 'Perks from Grimoire.');
	assert.strictEqual(sources[0].sourceUrl, undefined);
});

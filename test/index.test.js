const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, testAsync } = require('./summary');
const {
	assignPerkIds,
	buildDatabase,
	buildPerkDatabases,
	deriveSourceEdition,
	deriveSplitEdition,
	extractChapterFromFilename,
	normalizeCost,
	normalizeHeader,
	prepareItems,
	buildBackendGeneratorFiles,
	buildFileEditions,
	buildSourceMetadata,
	disambiguateLogicalKeys,
	deriveSourceEditionsConfig,
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
	assert.strictEqual(rows[0].origin, '007');
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
	assert.strictEqual(rows[0].origin, 'Metroid');
	assert.strictEqual(rows[0].cost, 0);
});

testAsync('parseCsv cleans separator junk from the name field', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-nameclean-'));
	const filePath = path.join(dir, 'Perks.csv');
	await fs.promises.writeFile(filePath, ['Perk,Cost,Effect', '-Black Mage-,200 CP,"Fields gravity."', 'Terror Force:,300 CP,"Pressure."'].join('\n'), 'utf8');
	const { rows } = await parseCsv(filePath);
	assert.strictEqual(rows[0].name, 'Black Mage');
	assert.strictEqual(rows[0].cost, 200);
	assert.strictEqual(rows[1].name, 'Terror Force');
	assert.strictEqual(rows[1].cost, 300);
});

test('extractChapterFromFilename strips common noise', () => {
	assert.strictEqual(extractChapterFromFilename('Copy - Items.csv'), 'Items');
});

test('deriveSourceEdition groups trailing v-number folders as source editions', () => {
	assert.deepStrictEqual(deriveSourceEdition('Grimoire v6'), {
		sourceId: 'grimoire',
		sourceDisplayName: 'Grimoire',
		editionVersion: 'v6',
		editionDisplayName: 'Grimoire V6',
		fileKey: 'grimoire_v6',
	});
	assert.deepStrictEqual(deriveSplitEdition('companion_lewd'), {
		sourceId: 'companion_lewd',
		sourceDisplayName: 'Companion Lewd',
		editionVersion: 'default',
		editionDisplayName: 'Companion Lewd',
		fileKey: 'companion_lewd',
	});
});

test('normalizeCost emits finite non-negative numbers', () => {
	assert.strictEqual(normalizeCost('Free'), 0);
	assert.strictEqual(normalizeCost('Free for All'), 0);
	assert.strictEqual(normalizeCost('Variable CP'), 0);
	assert.strictEqual(normalizeCost('-300CP'), 300);
	assert.strictEqual(normalizeCost(-300), 300);
	assert.strictEqual(normalizeCost(25), 25);
});

test('prepareItems and buildPerkDatabases create origin chapter name hierarchy', () => {
	const databases = new Map([
		[
			'grimoire_v2',
			{
				sourceId: 'grimoire',
				sourceDisplayName: 'Grimoire',
				editionVersion: 'v2',
				editionDisplayName: 'Grimoire V2',
				fileKey: 'grimoire_v2',
				rows: [
					{
						__origin: 'Sample Sheet',
						__line: 1,
						id: 10,
						cost: '100CP',
						name: 'Arcane Tuning',
						origin: 'Fate/Grand Master',
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
	assert.strictEqual(grouped.grimoire_v2.origin_fate_grand_master.chapters.parameters.perks.arcane_tuning[0].editionVersion, 'v2');
});

test('prepareItems strips a trailing cost parenthetical from the name when it duplicates the row cost', () => {
	const prepared = prepareItems(
		new Map([
			[
				'meros',
				{
					sourceId: 'meros',
					sourceDisplayName: 'Meros',
					editionVersion: 'default',
					editionDisplayName: 'Meros',
					fileKey: 'meros',
					rows: [
						{ __origin: 'Meros Sheet', __line: 1, name: 'Sacred Heuristic Omphalos (600 CP)', cost: '600 CP', origin: 'Heaven', chapter: 'Pseudo', description: 'A mountain.' },
						{ __origin: 'Meros Sheet', __line: 2, name: 'Breathing Style(100/200/400 CP)', cost: '0', origin: 'Heaven', chapter: 'Pseudo', description: 'Styles.' },
					],
				},
			],
		]),
	);
	const byName = Object.fromEntries(prepared.items.map(item => [item.perk.name, item.perk]));
	assert.strictEqual(byName['Sacred Heuristic Omphalos'].cost, 600);
	assert.strictEqual(byName['Breathing Style(100/200/400 CP)'].cost, 0);
});

test('prepareItems treats minus-prefixed costs as positive prices', () => {
	const prepared = prepareItems(
		new Map([
			[
				'meros',
				{
					sourceId: 'meros',
					sourceDisplayName: 'Meros',
					editionVersion: 'default',
					editionDisplayName: 'Meros',
					fileKey: 'meros',
					rows: [
						{ __origin: 'Meros Sheet', __line: 1, name: 'Willful', cost: '-100', origin: 'Heaven', chapter: 'Angels', description: 'Free will.' },
						{ __origin: 'Meros Sheet', __line: 2, name: 'Refunded (-100)', cost: '100', origin: 'Heaven', chapter: 'Angels', description: 'Keeps non-matching parenthetical.' },
					],
				},
			],
		]),
	);
	const byName = Object.fromEntries(prepared.items.map(item => [item.perk.name, item.perk]));
	assert.strictEqual(byName['Willful'].cost, 100);
	assert.strictEqual(byName['Refunded (-100)'].cost, 100);
	assert.strictEqual(Object.keys(byName).length, 2);
});

test('buildBackendGeneratorFiles produces importer-compatible edition files and source metadata', () => {
	const prepared = prepareItems(
		new Map([
			[
				'forge',
				{
					sourceId: 'forge',
					sourceDisplayName: 'Forge',
					editionVersion: 'default',
					editionDisplayName: 'Forge',
					fileKey: 'forge',
					rows: [{ __origin: 'Forge Sheet', __line: 1, name: 'Hammer Time', cost: 200, origin: 'The Forge', chapter: 'Tools', description: 'Make tools.' }],
				},
			],
		]),
	);
	const output = buildBackendGeneratorFiles(prepared.items, {});
	applySourceMetadataOverrides(output.sourceMetadata.sources, {
		forge: { description: 'Crafting perks.', editions: { default: { fileKey: 'forge', sourceUrl: 'https://example.com' } } },
	});

	assert.deepStrictEqual(validateBackendGeneratorFiles(output), []);
	assert.strictEqual(output.sourceMetadata.schemaVersion, 1);
	assert.strictEqual(output.sourceMetadata.sources[0].id, 'forge');
	assert.strictEqual(output.sourceMetadata.sources[0].defaultVersion, 'default');
	assert.deepStrictEqual(output.sourceMetadata.sources[0].editions, [{ fileKey: 'forge', version: 'default', sourceUrl: 'https://example.com' }]);
	assert.match(output.files.forge.Tools[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
	assert.strictEqual(output.files.forge.Tools[0].origin, 'The Forge');
});

test('buildBackendGeneratorFiles keeps UUIDs stable across regenerations', () => {
	const items = [
		{
			fileKey: 'forge',
			chapter: 'Tools',
			originName: 'The Forge',
			logicalKey: 'forge/forge_sheet/id_1',
			perk: { sourceId: 'forge', editionVersion: 'default', name: 'Hammer Time', cost: 200, description: 'Make tools.' },
		},
		{
			fileKey: 'forge',
			chapter: 'Tools',
			originName: 'The Forge',
			logicalKey: 'forge/forge_sheet/id_2',
			perk: { sourceId: 'forge', editionVersion: 'default', name: 'Anvil Time', cost: 300, description: 'Make heavier tools.' },
		},
	];
	const firstBuild = buildBackendGeneratorFiles(items, {});
	const secondBuild = buildBackendGeneratorFiles([...items].reverse(), {});
	const idsByName = build => Object.fromEntries(build.files.forge.Tools.map(perk => [perk.name, perk.id]));

	assert.deepStrictEqual(idsByName(secondBuild), idsByName(firstBuild));
});

test('buildSourceMetadata groups configured physical editions as source editions', () => {
	const files = { grimoire: { Main: [] }, grimoire_v2: { Main: [] }, forge: { Tools: [] } };
	const items = [
		{ fileKey: 'grimoire', perk: { editionDisplayName: 'Grimoire', isAdult: false } },
		{ fileKey: 'grimoire_v2', perk: { editionDisplayName: 'Grimoire V2', isAdult: false } },
		{ fileKey: 'forge', perk: { editionDisplayName: 'Forge', isAdult: false } },
	];
	const fileEditions = buildFileEditions(Object.keys(files), {
		grimoire: {
			displayName: 'Grimoire',
			defaultVersion: 'default',
			editions: { default: 'grimoire', v2: 'grimoire_v2' },
		},
	});
	const sources = buildSourceMetadata(files, items, fileEditions);
	const grimoire = sources.find(source => source.id === 'grimoire');

	assert.strictEqual(grimoire.defaultVersion, 'default');
	assert.deepStrictEqual(grimoire.editions.slice(0, 2), [
		{ fileKey: 'grimoire', version: 'default' },
		{ fileKey: 'grimoire_v2', version: 'v2' },
	]);
	assert.ok(sources.some(source => source.id === 'forge'));
});

test('buildSourceMetadata groups a standalone versioned edition under its base source', () => {
	const files = { song_v2: { Main: [] } };
	const items = [{ fileKey: 'song_v2', perk: { editionDisplayName: 'Song V2', isAdult: false } }];
	const sources = buildSourceMetadata(files, items, buildFileEditions(Object.keys(files), {}));

	assert.deepStrictEqual(sources, [
		{
			id: 'song',
			displayName: 'Song',
			description: 'Perks from Song.',
			isR18: false,
			defaultVersion: 'v2',
			editions: [{ fileKey: 'song_v2', version: 'v2' }],
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

testAsync('buildDatabase writes the perk ID registry only on an explicit write, keeping ids stable', async () => {
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
	await fs.promises.writeFile(configPath, JSON.stringify({ forge: { description: 'Crafting perks.', editions: { default: { fileKey: 'forge', sourceUrl: 'https://example.com' } } } }), 'utf8');

	const options = { sheetsRoot, registryPath, sourceMetadataConfigPath: configPath, datasetConfigPath: path.join(dir, 'dataset.json'), writeNyaDb: false, logger: { log() {}, warn() {}, error() {} } };

	const writerCalls = [];
	const stubWriter = async ({ files }) => {
		writerCalls.push(Object.keys(files));
		return { changed: [], unchanged: [], deleted: [] };
	};

	const first = await buildDatabase(options);
	assert.strictEqual(first.report.perkCount, 2);
	assert.deepStrictEqual(first.databases, ['forge']);
	assert.strictEqual(first.report.duplicateIdCount, 0);
	assert.strictEqual(fs.existsSync(registryPath), false, 'dry run must not create the registry file');
	assert.deepStrictEqual(writerCalls, [], 'dry run must not write databases');

	const writeOptions = { ...options, writeNyaDb: true, writeNyaDbDatabases: stubWriter };
	const written = await buildDatabase(writeOptions);
	assert.strictEqual(written.report.perkCount, 2);
	assert.strictEqual(writerCalls.length, 1, 'explicit write must invoke the database writer once');
	assert.strictEqual(written.registryChanged, true, 'first write creates a changed registry');
	const firstIds = JSON.parse(await fs.promises.readFile(registryPath, 'utf8')).active;
	assert.strictEqual(Object.keys(firstIds).length, 2);

	const afterWrite = await fs.promises.readFile(registryPath, 'utf8');
	const second = await buildDatabase(options);
	assert.strictEqual(second.report.perkCount, 2);
	assert.strictEqual(second.report.changedIdCountSincePreviousRender, 0);
	assert.strictEqual(writerCalls.length, 1, 'dry run must not trigger another database write');
	assert.strictEqual(second.registryChanged, false, 'dry run reports no registry change');
	assert.strictEqual(await fs.promises.readFile(registryPath, 'utf8'), afterWrite, 'dry run must not modify the registry file');

	const third = await buildDatabase(writeOptions);
	assert.strictEqual(third.registryChanged, false, 'an identical re-write reports no registry change');
	assert.strictEqual(writerCalls.length, 2);

	const canonical = await fs.promises.readFile(registryPath, 'utf8');
	await fs.promises.writeFile(registryPath, JSON.stringify(JSON.parse(canonical), null, 1), 'utf8');
	const fourth = await buildDatabase(writeOptions);
	assert.strictEqual(fourth.registryChanged, true, 'a registry in a non-canonical format is reported as changed');
	assert.strictEqual(await fs.promises.readFile(registryPath, 'utf8'), canonical, 'write restores the canonical registry format');
	assert.strictEqual(writerCalls.length, 3);
});

test('validateSourceMetadataConfig flags sources missing a manual entry', () => {
	const errors = validateSourceMetadataConfig([{ id: 'grimoire' }], {});
	assert.ok(errors.some(err => err.includes('grimoire') && err.includes('missing')));
});

test('validateSourceMetadataConfig flags manual entries with no matching source', () => {
	const errors = validateSourceMetadataConfig([], {
		orphan: { description: 'd', editions: { default: { fileKey: 'orphan', sourceUrl: 'https://example.com' } } },
	});
	assert.ok(errors.some(err => err.includes('orphan') && err.includes('unknown source')));
});

test('validateSourceMetadataConfig requires an editions map on every entry', () => {
	const errors = validateSourceMetadataConfig([{ id: 'grimoire' }], { grimoire: { description: 'd' } });
	assert.ok(errors.some(err => err.includes('missing an editions map')), errors.join('\n'));
});

test('validateSourceMetadataConfig requires a non-empty description and per-edition sourceUrl', () => {
	const errors = validateSourceMetadataConfig(
		[{ id: 'grimoire', editions: [{ version: 'default', fileKey: 'grimoire' }] }],
		{ grimoire: { description: '', editions: { default: { fileKey: 'grimoire', sourceUrl: '' } } } },
	);
	assert.ok(errors.some(err => err.includes('description')));
	assert.ok(errors.some(err => err.includes('empty sourceUrl for edition default')));
});

test('validateSourceMetadataConfig rejects top-level sourceUrl and the legacy editionUrls field', () => {
	const errors = validateSourceMetadataConfig(
		[{ id: 'grimoire', editions: [{ version: 'default', fileKey: 'grimoire' }] }],
		{ grimoire: { description: 'd', sourceUrl: 'https://example.com', editionUrls: { grimoire: 'https://example.com' }, editions: { default: { fileKey: 'grimoire', sourceUrl: 'https://example.com' } } } },
	);
	assert.ok(errors.some(err => err.includes('must not carry a top-level sourceUrl')), errors.join('\n'));
	assert.ok(errors.some(err => err.includes('legacy editionUrls')), errors.join('\n'));
});

test('validateSourceMetadataConfig requires altSourceUrl and altSourceLabel together per edition', () => {
	const errors = validateSourceMetadataConfig(
		[{ id: 'grimoire', editions: [{ version: 'default', fileKey: 'grimoire' }] }],
		{ grimoire: { description: 'd', editions: { default: { fileKey: 'grimoire', sourceUrl: 'https://example.com', altSourceUrl: 'https://alt.example.com' } } } },
	);
	assert.ok(errors.some(err => err.includes('altSourceUrl') && err.includes('altSourceLabel') && err.includes('edition default')));
});

test('validateSourceMetadataConfig passes for a fully matched, valid config', () => {
	const errors = validateSourceMetadataConfig(
		[{ id: 'grimoire', editions: [{ version: 'default', fileKey: 'grimoire' }] }],
		{ grimoire: { description: 'd', editions: { default: { fileKey: 'grimoire', sourceUrl: 'https://example.com' } } } },
	);
	assert.deepStrictEqual(errors, []);
});

test('applySourceMetadataOverrides replaces description and adds the edition sourceUrl', () => {
	const sources = [
		{
			id: 'grimoire',
			description: 'Perks from Grimoire.',
			defaultVersion: 'default',
			editions: [{ fileKey: 'grimoire', version: 'default' }],
		},
	];
	applySourceMetadataOverrides(sources, {
		grimoire: { description: 'Magical abilities and powers.', editions: { default: { fileKey: 'grimoire', sourceUrl: 'https://example.com' } } },
	});
	assert.strictEqual(sources[0].description, 'Magical abilities and powers.');
	assert.strictEqual(sources[0].editions[0].sourceUrl, 'https://example.com');
});

test('applySourceMetadataOverrides leaves sources without a manual entry untouched', () => {
	const sources = [
		{
			id: 'grimoire',
			description: 'Perks from Grimoire.',
			defaultVersion: 'default',
			editions: [{ fileKey: 'grimoire', version: 'default' }],
		},
	];
	applySourceMetadataOverrides(sources, {});
	assert.strictEqual(sources[0].description, 'Perks from Grimoire.');
	assert.strictEqual(sources[0].editions[0].sourceUrl, undefined);
});

test('applySourceMetadataOverrides places per-edition sourceUrl and alt links from an editions map', () => {
	const sources = [
		{
			id: 'grimoire',
			defaultVersion: 'default',
			editions: [
				{ fileKey: 'grimoire', version: 'default' },
				{ fileKey: 'grimoire_v2', version: 'v2' },
			],
		},
	];
	applySourceMetadataOverrides(sources, {
		grimoire: {
			description: 'Magical abilities and powers.',
			editions: {
				default: { fileKey: 'grimoire', sourceUrl: 'https://default.example.com', altSourceUrl: 'https://alt.example.com', altSourceLabel: 'Alt' },
				v2: { fileKey: 'grimoire_v2', sourceUrl: 'https://v2.example.com' },
			},
		},
	});
	assert.strictEqual(sources[0].editions[0].sourceUrl, 'https://default.example.com');
	assert.strictEqual(sources[0].editions[0].altSourceUrl, 'https://alt.example.com');
	assert.strictEqual(sources[0].editions[0].altSourceLabel, 'Alt');
	assert.strictEqual(sources[0].editions[1].sourceUrl, 'https://v2.example.com');
});

test('applySourceMetadataOverrides ignores a legacy top-level sourceUrl', () => {
	const sources = [
		{
			id: 'grimoire',
			defaultVersion: 'default',
			editions: [{ fileKey: 'grimoire', version: 'default' }],
		},
	];
	applySourceMetadataOverrides(sources, {
		grimoire: { description: 'Magical abilities and powers.', sourceUrl: 'https://top.example.com' },
	});
	assert.strictEqual(sources[0].editions[0].sourceUrl, undefined);
});

test('deriveSourceEditionsConfig returns groups only for sources with an editions map', () => {
	const groups = deriveSourceEditionsConfig({
		forge: { description: 'd' },
		grimoire: {
			description: 'd',
			editions: { default: { fileKey: 'grimoire' }, v2: { fileKey: 'grimoire_v2' } },
		},
	});
	assert.deepStrictEqual(Object.keys(groups), ['grimoire']);
	assert.deepStrictEqual(groups.grimoire, { defaultVersion: 'default', editions: { default: 'grimoire', v2: 'grimoire_v2' } });
});

test('deriveSourceEditionsConfig uses explicit defaultVersion', () => {
	const groups = deriveSourceEditionsConfig({
		song: { editions: { v2: { fileKey: 'song_v2' } }, defaultVersion: 'v2' },
	});
	assert.strictEqual(groups.song.defaultVersion, 'v2');
	assert.deepStrictEqual(groups.song.editions, { v2: 'song_v2' });
});

test('validateSourceMetadataConfig flags editions without a defaultVersion and without a "default" edition', () => {
	const sources = [{ id: 'grimoire', editions: [{ version: 'v2', fileKey: 'grimoire_v2' }] }];
	const errors = validateSourceMetadataConfig(sources, {
		grimoire: { description: 'd', editions: { v2: { fileKey: 'grimoire_v2', sourceUrl: 'https://v2.example.com' } } },
	});
	assert.ok(errors.some(err => err.includes('must include a "default" edition or set a defaultVersion')), errors.join('\n'));
});

test('validateSourceMetadataConfig flags a defaultVersion that is not an editions key', () => {
	const sources = [{ id: 'grimoire', editions: [{ version: 'default', fileKey: 'grimoire' }, { version: 'v2', fileKey: 'grimoire_v2' }] }];
	const errors = validateSourceMetadataConfig(sources, {
		grimoire: {
			description: 'd',
			defaultVersion: 'v999',
			editions: { default: { fileKey: 'grimoire', sourceUrl: 'https://example.com' }, v2: { fileKey: 'grimoire_v2', sourceUrl: 'https://v2.example.com' } },
		},
	});
	assert.ok(errors.some(err => err.includes('defaultVersion that is not an editions key')), errors.join('\n'));
});

test('validateSourceMetadataConfig passes for a source with a valid editions map', () => {
	const sources = [
		{
			id: 'grimoire',
			editions: [
				{ version: 'default', fileKey: 'grimoire' },
				{ version: 'v2', fileKey: 'grimoire_v2' },
			],
		},
	];
	const errors = validateSourceMetadataConfig(sources, {
		grimoire: {
			description: 'd',
			editions: {
				default: { fileKey: 'grimoire', sourceUrl: 'https://example.com' },
				v2: { fileKey: 'grimoire_v2', sourceUrl: 'https://v2.example.com' },
			},
		},
	});
	assert.deepStrictEqual(errors, []);
});

testAsync('buildDatabase inherits source editions from a manual config without needing sourceGroups', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-groups-'));
	const sheetsRoot = path.join(dir, 'sheets');
	const registryPath = path.join(dir, 'perk-id-registry.json');
	const configPath = path.join(dir, 'source-metadata.config.json');

	await fs.promises.mkdir(path.join(sheetsRoot, 'grimoire'), { recursive: true });
	await fs.promises.mkdir(path.join(sheetsRoot, 'grimoire_v2'), { recursive: true });
	await fs.promises.writeFile(
		path.join(sheetsRoot, 'grimoire', 'Grimoire.csv'),
		['Name,Cost,Source,Description', 'Spellcraft,100,Fate/Mage,Magic.'].join('\n'),
		'utf8',
	);
	await fs.promises.writeFile(
		path.join(sheetsRoot, 'grimoire_v2', 'Grimoire V2.csv'),
		['Name,Cost,Source,Description', 'Arcane Tuning,100,Fate/Grand Master,Tune.'].join('\n'),
		'utf8',
	);
	await fs.promises.writeFile(
		configPath,
		JSON.stringify({
			grimoire: {
				description: 'Magic.',
				editions: {
					default: { fileKey: 'grimoire', sourceUrl: 'https://example.com' },
					v2: { fileKey: 'grimoire_v2', sourceUrl: 'https://v2.example.com' },
				},
			},
		}),
		'utf8',
	);

	const options = { sheetsRoot, registryPath, sourceMetadataConfigPath: configPath, datasetConfigPath: path.join(dir, 'dataset.json'), writeNyaDb: false, logger: { log() {}, warn() {}, error() {} } };
	const result = await buildDatabase(options);

	assert.strictEqual(result.report.sourceCount, 1);
	assert.strictEqual(result.report.editionCount, 2);
	assert.deepStrictEqual(result.databases, ['grimoire', 'grimoire_v2']);
	assert.ok(result.report.validationErrorCount === 0, result.report.validationErrorCount);
});

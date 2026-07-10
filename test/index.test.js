const assert = require('assert');
const {
	buildPerkDatabases,
	collectSplitRows,
	deriveCategoryVersion,
	deriveSplitCategory,
	extractChapterFromFilename,
	normalizeCost,
	normalizeHeader,
	prepareItems,
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

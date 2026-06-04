const assert = require('assert');
const { collectSplitRows, extractChapterFromFilename, normalizeHeader } = require('../index');

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

	assert.deepStrictEqual(Object.keys(splitBuckets).sort(), ['companion_(lewd)', 'waifu']);
	assert.strictEqual(splitBuckets.waifu.length, 1);
	assert.strictEqual(splitBuckets['companion_(lewd)'].length, 1);
	assert.deepStrictEqual(database, {
		1: [{ name: 'Keep me', chapter: 'Main' }],
		2: [],
	});
});

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseEntry, parseMarkdown } = require('../md-parser');

function test(name, fn) {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (err) {
		console.error(`not ok - ${name}`);
		throw err;
	}
}

async function testAsync(name, fn) {
	try {
		await fn();
		console.log(`ok - ${name}`);
	} catch (err) {
		console.error(`not ok - ${name}`);
		throw err;
	}
}

test('parseEntry handles cost before name', () => {
	assert.deepStrictEqual(parseEntry('(200 CP) Example Name - Example description.'), {
		name: 'Example Name',
		cost: '200 CP',
		descStart: 'Example description.',
	});
});

test('parseEntry handles bracket cost before name', () => {
	assert.deepStrictEqual(parseEntry('[Free] Example Name: Example description.'), {
		name: 'Example Name',
		cost: 'Free',
		descStart: 'Example description.',
	});
});

test('parseEntry handles name before bracket cost', () => {
	assert.deepStrictEqual(parseEntry('Example Name [300 CP] - Example description.'), {
		name: 'Example Name',
		cost: '300 CP',
		descStart: 'Example description.',
	});
});

test('parseEntry handles tiered cost before name', () => {
	assert.deepStrictEqual(parseEntry('Free/200/400 - Power and Majesty - It is unbecoming.'), {
		name: 'Power and Majesty',
		cost: 'Free/200/400',
		descStart: 'It is unbecoming.',
	});
});

test('parseEntry handles numeric parenthetical cost with requirements', () => {
	assert.deepStrictEqual(parseEntry("Dawn of Demigodhood (300, requires A Heroic Saga): Some Scions' lives are fraught."), {
		name: 'Dawn of Demigodhood',
		cost: '300',
		descStart: "Some Scions' lives are fraught.",
	});
});

test('parseEntry handles numeric parenthetical cost without CP suffix', () => {
	assert.deepStrictEqual(parseEntry('Heku (300): The ancient Egyptian understanding of the soul.'), {
		name: 'Heku',
		cost: '300',
		descStart: 'The ancient Egyptian understanding of the soul.',
	});
});

test('parseEntry handles leading type and trailing numeric cost', () => {
	assert.deepStrictEqual(parseEntry('(Structure) The Worldstone (-4000):'), {
		name: 'The Worldstone',
		cost: '-4000',
		descStart: '',
	});
});

test('parseEntry handles CP prefix with double dash separators', () => {
	assert.deepStrictEqual(parseEntry("100CP -- Two-faced -- protects against people easily detecting other identity"), {
		name: 'Two-faced',
		cost: '100CP',
		descStart: 'protects against people easily detecting other identity',
	});
});

test('parseEntry handles CP prefix with colon separator', () => {
	assert.deepStrictEqual(parseEntry('200CP: Demigod - Blessed child.'), {
		name: 'Demigod',
		cost: '200CP',
		descStart: 'Blessed child.',
	});
});

test('parseEntry handles CP prefix with name colon description', () => {
	assert.deepStrictEqual(parseEntry('200 cp: Hellfire: Power over fire is yours!'), {
		name: 'Hellfire',
		cost: '200 cp',
		descStart: 'Power over fire is yours!',
	});
});

test('parseEntry handles numeric prefix with spaced colon separator', () => {
	assert.deepStrictEqual(parseEntry('100 :Knowledge of the First - Those rare few.'), {
		name: 'Knowledge of the First',
		cost: '100',
		descStart: 'Those rare few.',
	});
});

test('parseEntry handles soft-hyphen cost prefix with sentence separator', () => {
	assert.deepStrictEqual(parseEntry('100­ Talented. In this world it is rare to find a true jack of all trades.'), {
		name: 'Talented',
		cost: '100',
		descStart: 'In this world it is rare to find a true jack of all trades.',
	});
});

test('parseEntry handles soft-hyphen cost prefix with dash title separator', () => {
	assert.deepStrictEqual(parseEntry('300­ The Emerald Circle ­ It is within the grasp of all in creation.'), {
		name: 'The Emerald Circle',
		cost: '300',
		descStart: 'It is within the grasp of all in creation.',
	});
});

test('parseEntry handles name cost description separated by dashes', () => {
	assert.deepStrictEqual(parseEntry("Strontian - 600 - A humanoid purple skinned race from the Shi'ar Empire."), {
		name: 'Strontian',
		cost: '600',
		descStart: "A humanoid purple skinned race from the Shi'ar Empire.",
	});
});

test('parseEntry handles name cost description when first dash is tight', () => {
	assert.deepStrictEqual(parseEntry('The Abyss- 100 - You are a sister being to Ex Nihilo.'), {
		name: 'The Abyss',
		cost: '100',
		descStart: 'You are a sister being to Ex Nihilo.',
	});
});

test('parseEntry handles negative numeric parenthetical cost with description', () => {
	assert.deepStrictEqual(parseEntry('Mysterious Skills (-100): Some Primarchs had more odd traits than others.'), {
		name: 'Mysterious Skills',
		cost: '-100',
		descStart: 'Some Primarchs had more odd traits than others.',
	});
});

test('parseEntry handles bracket cost with colon description', () => {
	assert.deepStrictEqual(parseEntry("Cerebral Voiding [100]: That's funny."), {
		name: 'Cerebral Voiding',
		cost: '100',
		descStart: "That's funny.",
	});
});

test('parseEntry handles bracket cost with space description', () => {
	assert.deepStrictEqual(parseEntry('Receptacle of Faith [Free] You are a Demon.'), {
		name: 'Receptacle of Faith',
		cost: 'Free',
		descStart: 'You are a Demon.',
	});
});

test('parseEntry prefers cost bracket before requirement bracket', () => {
	assert.deepStrictEqual(parseEntry('Atimaharathi [600 KP] [Requires Superwarrior]'), {
		name: 'Atimaharathi',
		cost: '600 KP',
		descStart: '',
	});
});

testAsync('parseMarkdown keeps chapter and description boundaries', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-md-'));
	const filePath = path.join(dir, 'sample.md');

	await fs.promises.writeFile(
		filePath,
		[
			'Main Source',
			'',
			'Perks:',
			'',
			'1. [Free] First Thing: First inline sentence.',
			'Second sentence continues here.',
			'',
			'2. Second Thing (200 CP) - Another inline sentence.',
			'Another continued line.',
			'',
			'Items:',
			'',
			'3. (300 CP) Third Thing - Third description.',
		].join('\n'),
		'utf8',
	);

	const { rows } = await parseMarkdown(filePath);

	assert.strictEqual(rows.length, 3);
	assert.deepStrictEqual(
		rows.map(row => ({ id: row.id, cost: row.cost, name: row.name, chapter: row.chapter, source: row.source })),
		[
			{ id: 1, cost: 0, name: 'First Thing', chapter: 'Perks', source: 'sample' },
			{ id: 2, cost: 200, name: 'Second Thing', chapter: 'Perks', source: 'sample' },
			{ id: 3, cost: 300, name: 'Third Thing', chapter: 'Items', source: 'sample' },
		],
	);
	assert.strictEqual(rows[0].description, 'First inline sentence. Second sentence continues here.');
});

testAsync('parseMarkdown recovers title from cost-only line followed by title colon description', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-md-'));
	const filePath = path.join(dir, 'sample.md');

	await fs.promises.writeFile(
		filePath,
		[
			'Items:',
			'',
			'557. 100 cp',
			'',
			'Lots of Guns: You own a lot of legally licensed and registered firearms.',
			'Second sentence continues here.',
		].join('\n'),
		'utf8',
	);

	const { rows } = await parseMarkdown(filePath);

	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].cost, 100);
	assert.strictEqual(rows[0].name, 'Lots of Guns');
	assert.strictEqual(
		rows[0].description,
		'You own a lot of legally licensed and registered firearms. Second sentence continues here.',
	);
});

testAsync('parseMarkdown handles name line followed by cost line', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-md-'));
	const filePath = path.join(dir, 'sample.md');

	await fs.promises.writeFile(
		filePath,
		[
			'Pseudo:',
			'',
			'139. (Criminally) Insane Dedication',
			'',
			'600 CP',
			'',
			'You know hatred.',
		].join('\n'),
		'utf8',
	);

	const { rows } = await parseMarkdown(filePath);

	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].cost, 600);
	assert.strictEqual(rows[0].name, 'Insane Dedication');
	assert.strictEqual(rows[0].description, 'You know hatred.');
});

testAsync('parseMarkdown uses preceding heading as name for cost-only entries', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-md-'));
	const filePath = path.join(dir, 'sample.md');

	await fs.promises.writeFile(
		filePath,
		[
			'God',
			'',
			'90. 1200 CP',
			'',
			'A very long time ago, humanity looked up and wondered.',
		].join('\n'),
		'utf8',
	);

	const { rows } = await parseMarkdown(filePath);

	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].cost, 1200);
	assert.strictEqual(rows[0].name, 'God');
	assert.strictEqual(rows[0].description, 'A very long time ago, humanity looked up and wondered.');
});

testAsync('parseMarkdown merges long costless numbered continuations into previous row', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-chaos-md-'));
	const filePath = path.join(dir, 'sample.md');

	await fs.promises.writeFile(
		filePath,
		[
			'Items:',
			'',
			'157. [100] Meta Fiction: Each of your adventures will be recorded.',
			'',
			'158. Discovering just what happened to an artifact after you lost it becomes pretty simple when it is literally spelled out for you.',
		].join('\n'),
		'utf8',
	);

	const { rows } = await parseMarkdown(filePath);

	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].name, 'Meta Fiction');
	assert.strictEqual(
		rows[0].description,
		'Each of your adventures will be recorded. Discovering just what happened to an artifact after you lost it becomes pretty simple when it is literally spelled out for you.',
	);
});

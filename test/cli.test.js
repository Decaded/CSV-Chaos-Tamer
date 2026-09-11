const assert = require('assert');
const { test } = require('./summary');
const { parseArgs } = require('../src/cli');

test('parseArgs defaults to a dry run', () => {
	const args = parseArgs([]);
	assert.strictEqual(args.writeNyaDb, false);
});

test('parseArgs treats --write as write mode', () => {
	const args = parseArgs(['--write']);
	assert.strictEqual(args.writeNyaDb, true);
});

test('parseArgs accepts values with =', () => {
	const args = parseArgs(['--root=/tmp/foo', '--registry=/tmp/reg.json']);
	assert.strictEqual(args.root, '/tmp/foo');
	assert.strictEqual(args.registryPath, '/tmp/reg.json');
});

test('parseArgs ignores unknown flags', () => {
	const args = parseArgs(['--bogus', '--write']);
	assert.strictEqual(args.writeNyaDb, true);
});
const assert = require('assert');
const { test } = require('./summary');
const { shared } = require('../src/config/settings');

test('isIntentionalBoundaryName recognizes joke/emphasis names by shape', () => {
	const { isIntentionalBoundaryName } = shared;
	assert.strictEqual(isIntentionalBoundaryName('Oo -Burp-'), true);
	assert.strictEqual(isIntentionalBoundaryName('ARMOR LOCK ARMOR LOCK ARMOR LOCK ARMOR L-'), true);
	assert.strictEqual(isIntentionalBoundaryName('AAAAAAHHH-'), true);
});

test('isIntentionalBoundaryName rejects real boundary junk', () => {
	const { isIntentionalBoundaryName } = shared;
	assert.strictEqual(isIntentionalBoundaryName('-Black Mage-'), false);
	assert.strictEqual(isIntentionalBoundaryName('-Cannoneer-'), false);
	assert.strictEqual(isIntentionalBoundaryName('Ahnenerbe -'), false);
	assert.strictEqual(isIntentionalBoundaryName('Terror Force:'), false);
	assert.strictEqual(isIntentionalBoundaryName(''), false);
	assert.strictEqual(isIntentionalBoundaryName(null), false);
	assert.strictEqual(isIntentionalBoundaryName('A-'), false);
});

test('cleanName preserves intentional boundary punctuation', () => {
	assert.strictEqual(shared.cleanName('Oo -Burp-'), 'Oo -Burp-');
	assert.strictEqual(shared.cleanName('ARMOR LOCK ARMOR LOCK ARMOR LOCK ARMOR L-'), 'ARMOR LOCK ARMOR LOCK ARMOR LOCK ARMOR L-');
	assert.strictEqual(shared.cleanName('\u200BA\u200BAAAAAHHH-'), 'AAAAAAHHH-');
});

test('cleanName strips boundary junk and zero-width spaces', () => {
	assert.strictEqual(shared.cleanName('-Black Mage-'), 'Black Mage');
	assert.strictEqual(shared.cleanName('\u200B\u200B-Cannoneer-'), 'Cannoneer');
	assert.strictEqual(shared.cleanName('Ahnenerbe -'), 'Ahnenerbe');
	assert.strictEqual(shared.cleanName('Terror Force:'), 'Terror Force');
	assert.strictEqual(shared.cleanName('-1300 CP Something'), '-1300 CP Something');
});
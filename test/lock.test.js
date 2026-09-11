const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./summary');
const { acquire, release } = require('../src/lock');

function tempLock() {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csv-chaos-lock-')), 'test.lock');
}

test('acquire succeeds when no lock is held and records the pid', () => {
	const lockPath = tempLock();
	const result = acquire(lockPath);
	assert.strictEqual(result.ok, true);
	assert.match(fs.readFileSync(lockPath, 'utf8').trim(), /^\d+$/);
	release(lockPath);
	assert.strictEqual(fs.existsSync(lockPath), false);
});

test('second acquire fails while the first lock is held', () => {
	const lockPath = tempLock();
	assert.strictEqual(acquire(lockPath).ok, true);
	const second = acquire(lockPath);
	assert.strictEqual(second.ok, false);
	assert.ok(second.holder);
	release(lockPath);
});

test('release frees the lock for the next acquire', () => {
	const lockPath = tempLock();
	acquire(lockPath);
	release(lockPath);
	assert.strictEqual(acquire(lockPath).ok, true);
	release(lockPath);
});

test('stale lock from a dead process is reclaimed', () => {
	const lockPath = tempLock();
	fs.writeFileSync(lockPath, '999999\n');
	const result = acquire(lockPath);
	assert.strictEqual(result.ok, true);
	release(lockPath);
});

test('release never deletes a lock owned by another pid', () => {
	const lockPath = tempLock();
	acquire(lockPath);
	fs.writeFileSync(lockPath, '999999\n');
	release(lockPath);
	assert.strictEqual(fs.existsSync(lockPath), true);
	fs.unlinkSync(lockPath);
});

test('acquire throws for an unwritable lock location', () => {
	const lockPath = path.join(os.tmpdir(), 'no-such-dir-xyz', 'test.lock');
	assert.throws(() => acquire(lockPath), /ENOENT/);
});
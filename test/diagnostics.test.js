const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./summary');
const { buildFailureReport, detectZeroRowFiles, selfHelpSuggestions, formatCliFailure } = require('../src/diagnostics');

test('detectZeroRowFiles pulls folder/file from 0-row log lines', () => {
	const logs = [
		{ level: 'info', message: 'celestrial_workshop/Power Armor.csv → 0 rows, max CP: 0' },
		{ level: 'info', message: 'vault/The Celestial Vault - Workshop.csv → 8 rows, max CP: 400' },
		{ level: 'info', message: 'prospectorzone/Mining.csv → 0 rows, max CP: 0' },
	];
	assert.deepStrictEqual(detectZeroRowFiles(logs), [
		'celestrial_workshop/Power Armor.csv',
		'prospectorzone/Mining.csv',
	]);
});

test('buildFailureReport surfaces validation issues, self-help, env, and a pre-filled bug link', () => {
	const error = new Error('Prepared data failed validation');
	error.validationErrors = [
		'source-metadata.config.json has an entry for unknown source celestrial_workshop',
		'Source bordello is missing a source-metadata.config.json entry',
		'source-metadata.config.json entry for vault is missing a sourceUrl',
	];
	const report = buildFailureReport({
		error,
		mode: 'cli',
		writeNyaDb: false,
		context: { sourcesRoot: '/repo/sources', sourceMetadataConfigPath: '/repo/src/config/source-metadata.config.json' },
	});

	assert.strictEqual(report.issues.length, 3);
	assert.strictEqual(report.truncatedIssueCount, 0);
	assert.match(report.summary, /3 validation issue\(s\)/);
	assert.ok(report.selfHelp.some(hint => hint.includes('celestrial_workshop')));
	assert.ok(report.selfHelp.some(hint => hint.includes('bordello')));
	assert.ok(report.selfHelp.some(hint => hint.includes('sourceUrl')));
	assert.match(report.bugReportUrl, /^https:\/\/github\.com\/Decaded\/CSV-Chaos-Tamer\/issues\/new\?/);
	assert.ok(report.bugReportUrl.includes(encodeURIComponent('bug_report.md')));
	assert.ok(report.bugReportBody.includes('celestrial_workshop'));
	assert.ok(report.bugReportBody.includes('csv-chaos-tamer v'));
	assert.strictEqual(report.env.mode, 'cli');
	assert.ok(report.env.node);
	assert.match(report.issuesUrl, /issues$/);
});

test('selfHelpSuggestions: existing folder with no usable rows → 0-row hint', () => {
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-test-'));
	fs.mkdirSync(path.join(tmpRoot, 'celestrial_workshop'), { recursive: true });
	const hints = selfHelpSuggestions({
		errors: ['source-metadata.config.json has an entry for unknown source celestrial_workshop'],
		zeroRowFiles: [],
		sourcesRoot: tmpRoot,
	});
	assert.ok(hints.some(hint => hint.includes('celestrial_workshop')));
	assert.ok(hints.some(hint => hint.includes('every file in it either parsed to 0 rows')));
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('selfHelpSuggestions: missing folder → rename/delete hint', () => {
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-test-'));
	const hints = selfHelpSuggestions({
		errors: ['source-metadata.config.json has an entry for unknown source celestrial_workshop'],
		zeroRowFiles: [],
		sourcesRoot: tmpRoot,
	});
	assert.ok(hints.some(hint => hint.includes('no folder sources/celestrial_workshop/')));
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('selfHelpSuggestions keeps range of hint types for common errors', () => {
	const hints = selfHelpSuggestions({
		errors: [
			'Source bordello is missing a source-metadata.config.json entry',
			'source-metadata.config.json entry for vault is missing a sourceUrl',
		],
		zeroRowFiles: [],
		sourcesRoot: null,
	});
	assert.ok(hints.some(hint => hint.includes('bordello')));
	assert.ok(hints.some(hint => hint.includes('sourceUrl')));
});

test('buildFailureReport keeps a generic path for non-validation failures', () => {
	const report = buildFailureReport({ error: new Error('ENOENT: no such file'), mode: 'web', writeNyaDb: true });
	assert.strictEqual(report.issues.length, 0);
	assert.strictEqual(report.summary, 'ENOENT: no such file');
	assert.ok(report.selfHelp.some(hint => hint.includes('Most failures are one of two things')));
});

test('formatCliFailure renders a printable block with the bug-report body', () => {
	const report = buildFailureReport({ error: Object.assign(new Error('x'), { validationErrors: ['a bad one'] }), mode: 'cli' });
	const lines = formatCliFailure(report);
	const text = lines.join('\n');
	assert.ok(text.includes('Build failed ✖'));
	assert.ok(text.includes('How to fix this yourself'));
	assert.ok(text.includes('BEGIN BUG REPORT'));
	assert.ok(text.includes('END BUG REPORT'));
	assert.ok(text.includes(report.bugReportUrl));
});

test('log lines are capped in the bug body but issues stay intact', () => {
	const logs = [];
	for (let i = 0; i < 80; i += 1) logs.push({ level: 'info', message: `line ${i}` });
	const report = buildFailureReport({ error: new Error('boom'), logs });
	const lastLineCount = report.bugReportBody.match(/line \d+/g)?.length || 0;
	assert.ok(lastLineCount <= 30, `expected <= 30 log lines in body, got ${lastLineCount}`);
});

test('formatCliFailure shortens UUIDs in the issue bullets but keeps them in the bug body', () => {
	const fullUuid = '93ab5e7c-1f2d-4b9e-8c3d-0a1b2c3d4e5f';
	const error = new Error('x');
	error.validationErrors = [`Invalid perk ${fullUuid}`];
	const report = buildFailureReport({ error, mode: 'cli' });
	const lines = formatCliFailure(report);
	assert.ok(lines.some(line => line.includes(`93ab5e7c…`) && !line.includes(fullUuid)));
	assert.ok(report.bugReportBody.includes(fullUuid));
});
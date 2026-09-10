const path = require('path');
const fs = require('fs');

const { buildDatabase } = require('./index');
const lockApi = require('./lock');
const { ID_REGISTRY_PATH } = require('./registry/perk-registry');

const SOURCES_ROOT = path.join(__dirname, '..', 'sources');

function parseArgs(argv) {
	const args = argv.slice();
	let root = SOURCES_ROOT;
	let registryPath = ID_REGISTRY_PATH;
	let sourceMetadataConfigPath;
	let writeNyaDb = true;

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		const [flag, value] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
		if (flag === '--root') root = path.resolve(value || args[++i]);
		else if (flag === '--registry') registryPath = path.resolve(value || args[++i]);
		else if (flag === '--config') sourceMetadataConfigPath = path.resolve(value || args[++i]);
		else if (flag === '--no-nya-db') writeNyaDb = false;
	}

	return { root, registryPath, sourceMetadataConfigPath, writeNyaDb };
}

function makeReportAwareLogger(stdout, stderr) {
	return {
		log: (...a) => {
			const message = a.map(String).join(' ');
			if (!message.trimStart().startsWith('{')) stdout(message);
		},
		warn: (...a) => stderr(`WARN: ${a.map(String).join(' ')}`),
		error: (...a) => {
			const message = a.map(String).join(' ');
			if (!message.trimStart().startsWith('{')) stderr(`ERROR: ${message}`);
		},
	};
}

function createSpinner() {
	const enabled = Boolean(process.stdout.isTTY);
	if (!enabled) return { start() {}, clear() {}, draw() {}, stop() {} };

	const frames = ['|', '/', '-', '\\'];
	let index = 0;
	let timer = null;

	function draw() {
		index = (index + 1) % frames.length;
		process.stdout.write(`\r ${frames[index]} working...`);
	}

	function clear() {
		process.stdout.write('\r');
		process.stdout.write(' '.repeat(20));
		process.stdout.write('\r');
	}

	return {
		start() {
			if (timer) return;
			draw();
			timer = setInterval(draw, 100);
		},
		clear,
		draw,
		stop() {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			clear();
		},
	};
}

function friendlySummary(report, databasesUpdated) {
	return [
		`  Dataset version       : ${report.datasetVersion}`,
		`  Perks written         : ${report.perkCount}${report.adultPerkCount ? ` (${report.adultPerkCount} adult)` : ''}`,
		`  Sources               : ${report.sourceCount}`,
		`  Categories            : ${report.categoryCount}`,
		`  Chapters              : ${report.chapterCount}`,
		`  Duplicate perk IDs    : ${report.duplicateIdCount}`,
		`  Validation errors     : ${report.validationErrorCount}`,
		`  Databases updated     : ${databasesUpdated}`,
	].join('\n');
}

function gitGuidance() {
	return [
		'  1. git add sources/ NyaDB/',
		'  2. git commit -m "Add perks from your source"',
		'  3. git push origin your-branch',
		'  4. Open a pull request against the main repository',
	].join('\n');
}

function printFriendlyErrors(errors) {
	const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
	return errors
		.map(error => {
			const short = uuid.test(error) ? error.replace(uuid, match => `${match.slice(0, 8)}…`) : error;
			return `  • ${short}`;
		})
		.join('\n');
}

async function runBuild({ root, registryPath, sourceMetadataConfigPath, writeNyaDb }) {
	const spinner = createSpinner();
	const logger = makeReportAwareLogger(
		line => {
			spinner.clear();
			console.log(line);
			spinner.draw();
		},
		line => {
			spinner.clear();
			console.error(line);
			spinner.draw();
		},
	);
	spinner.start();

	let lock = null;
	let lockError = null;
	try {
		lock = lockApi.acquire();
		if (!lock.ok) {
			spinner.stop();
			console.error('\nAnother build is already running (the web panel or another CLI instance).');
			console.error('Close the web panel or wait until it finishes, then re-run this script.');
			process.exitCode = 3;
			return;
		}

		for (const signal of ['SIGINT', 'SIGTERM']) {
			process.once(signal, () => {
				lockApi.release();
				process.exit(signal === 'SIGINT' ? 130 : 143);
			});
		}
	} catch (error) {
		lockError = error;
		spinner.stop();
		console.error(`\nUnable to acquire the build lock: ${error.message}`);
		process.exitCode = 3;
		return;
	}

	try {
		const { report, writtenDatabases } = await buildDatabase({ sheetsRoot: root, registryPath, sourceMetadataConfigPath, writeNyaDb, logger });
		spinner.stop();
		const updatedCount = writtenDatabases.changed.length + writtenDatabases.deleted.length;
		console.log('\nBuild succeeded ✔');
		console.log(friendlySummary(report, updatedCount));
		if (writeNyaDb) {
			if (updatedCount === 0) {
				console.log('\nNo changes were made to the database files.');
			} else {
				console.log('\nThe NyaDB files above are ready to submit. Open a pull request:');
				console.log(gitGuidance());
			}
		} else {
			console.log('\nNyaDB write skipped (--no-nya-db) — nothing was stored.');
		}
	} catch (err) {
		spinner.stop();
		const errors = err.validationErrors || [];
		console.error('\nBuild failed ✖ The data did not pass validation, so NyaDB was NOT updated.');
		if (errors.length) {
			console.error(`\n${errors.length} issue(s) to fix:\n`);
			console.error(printFriendlyErrors(errors));
			console.error("\nFix the issues above in sources/, then re-run this script.");
		} else {
			console.error(err.message);
		}
		process.exitCode = 1;
	} finally {
		if (lock && lock.ok) {
			lockApi.release();
		}
	}
}

function runWithSpinner() {
	const { spawn } = require('child_process');
	const child = spawn(process.execPath, [__filename, ...process.argv.slice(2)], { stdio: ['inherit', 'pipe', 'pipe'] });
	const spinner = createSpinner();
	spinner.start();

	function relay(stream, target) {
		stream.on('data', chunk => {
			spinner.clear();
			target.write(chunk);
		});
	}
	relay(child.stdout, process.stdout);
	relay(child.stderr, process.stderr);

	child.on('error', err => {
		spinner.stop();
		console.error(err);
		process.exitCode = 1;
	});
	child.on('exit', code => {
		spinner.stop();
		if (typeof code === 'number') process.exitCode = code;
	});
	process.on('exit', () => child.kill());
}

async function main() {
	const { root, registryPath, sourceMetadataConfigPath, writeNyaDb } = parseArgs(process.argv);

	if (!fs.existsSync(root)) {
		console.error(`Sources folder not found: ${root}`);
		console.error('Drop CSV/Markdown files into a subfolder of sources/ and re-run this script.');
		process.exit(2);
	}

	if (process.stdout.isTTY) {
		runWithSpinner();
		return;
	}

	await runBuild({ root, registryPath, sourceMetadataConfigPath, writeNyaDb });
}

if (require.main === module) main().catch(err => {
	console.error(err);
	process.exitCode = 1;
});

module.exports = { parseArgs, makeReportAwareLogger, createSpinner, friendlySummary, gitGuidance, printFriendlyErrors };
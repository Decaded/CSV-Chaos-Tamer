let passed = 0;
let failed = 0;

function test(name, fn) {
	try {
		fn();
		passed += 1;
		console.log(`\x1b[32mpassed\x1b[0m - ${name}`);
	} catch (err) {
		failed += 1;
		console.error(`\x1b[31mfailed\x1b[0m - ${name}`);
		throw err;
	}
}

async function testAsync(name, fn) {
	try {
		await fn();
		passed += 1;
		console.log(`\x1b[32mpassed\x1b[0m - ${name}`);
	} catch (err) {
		failed += 1;
		console.error(`\x1b[31mfailed\x1b[0m - ${name}`);
		throw err;
	}
}

function printSummary() {
	const total = passed + failed;
	const rate = total ? Math.round((passed / total) * 100) : 0;
	const status = failed ? 'FAILED' : 'PASSED';
	const rows = [
		['Passed', String(passed)],
		['Failed', String(failed)],
		['Total', String(total)],
		['Pass rate', `${rate}%`],
	];
	const leftWidth = 'Pass rate'.length + 1;
	const rightWidth = 12;
	const width = leftWidth + rightWidth + 1;
	console.log(`\n┌${'─'.repeat(leftWidth)}┬${'─'.repeat(rightWidth)}┐`);
	console.log(`│${'Metric'.padEnd(leftWidth)}│${'Result'.padStart(rightWidth)}│`);
	console.log(`├${'─'.repeat(leftWidth)}┼${'─'.repeat(rightWidth)}┤`);
	for (const [label, value] of rows) console.log(`│${label.padEnd(leftWidth)}│${value.padStart(rightWidth)}│`);
	console.log(`├${'─'.repeat(leftWidth)}┴${'─'.repeat(rightWidth)}┤`);
	const color = failed ? '\x1b[31m' : '\x1b[32m';
	const reset = '\x1b[0m';
	console.log(`│${color}${`Result: ${status}`.padEnd(width)}${reset}│`);
	console.log(`└${'─'.repeat(width)}┘`);
}

process.on('exit', printSummary);

module.exports = { test, testAsync };
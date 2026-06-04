const path = require('path');
const { parseMarkdown } = require('../md-parser');

function isSuspicious(row) {
	return (
		!row.name ||
		!row.description ||
		row.description.length < 10 ||
		(typeof row.cost !== 'number' && !/free|special|variable|\d/i.test(String(row.cost))) ||
		/^\d+\s*(?:CP|BP|KP)?$/i.test(row.name) ||
		/^\[.*\]$/.test(row.name)
	);
}

async function main() {
	const filePath = process.argv[2];
	if (!filePath) {
		console.error('Usage: node scripts/md-diagnose.js <file.md>');
		process.exitCode = 1;
		return;
	}

	const { rows } = await parseMarkdown(filePath);
	const suspicious = rows.filter(isSuspicious);
	const byChapter = new Map();
	const bySource = new Map();

	for (const row of rows) {
		byChapter.set(row.chapter, (byChapter.get(row.chapter) || 0) + 1);
		bySource.set(row.source, (bySource.get(row.source) || 0) + 1);
	}

	console.log(`File: ${path.basename(filePath)}`);
	console.log(`Rows parsed: ${rows.length}`);
	console.log(`Suspicious rows: ${suspicious.length}`);
	console.log(`Chapters: ${byChapter.size}`);
	console.log(`Sources: ${bySource.size}`);

	if (suspicious.length) {
		console.log('\nFirst suspicious rows:');
		for (const row of suspicious.slice(0, 20)) {
			console.log(
				JSON.stringify({
					id: row.id,
					cost: row.cost,
					name: row.name,
					chapter: row.chapter,
					source: row.source,
					descriptionLength: row.description?.length || 0,
				}),
			);
		}
	}
}

main().catch(err => {
	console.error(err);
	process.exitCode = 1;
});

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { parseMarkdown } = require('./md-parser');
const { shared, csv: csvConfig } = require('./config');

const SHEETS_ROOT = path.join(__dirname, 'sheets');
const OUT_ROOT = path.join(__dirname, 'data');

const headerMap = csvConfig.headerMap;
const transformMap = csvConfig.transforms;
const SPLIT_CHAPTERS = shared.splitChapters;

const fallbackHeaders = csvConfig.fallbackHeaders;

/**
 * Normalizes a header by lowercasing and stripping non-alphabetic characters.
 * @param {string} h - Raw header
 * @returns {string|null} Normalized header or null if falsy
 */
const normalizeHeader = h => (h ? h.toLowerCase().replace(/[^a-z]/g, '') : null);

const slugify = shared.slugify;

/**
 * Extracts chapter name from a CSV filename by removing common patterns and formatting.
 * @param {string} filename - Filename including extension
 * @returns {string} Clean chapter name
 */
function extractChapterFromFilename(filename) {
	let name = filename.replace(/\.csv$/i, '');
	let candidate = name
		.split(/[-:_]/)
		.map(s => s.trim())
		.filter(Boolean)
		.pop();
	return (
		candidate
			.replace(/\([^)]*\)/g, '')
			.replace(/[\d]+|Perks/gi, '')
			.replace(/_/g, ' ')
			.trim() || name
	);
}

/**
 * Parses a single CSV file into a structured object array.
 * Applies header normalization, mapping, and transformations.
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<{rows: object[], maxCP: number}>} Parsed rows and maximum CP value found
 */
async function parseCsv(filePath) {
	const content = await fs.promises.readFile(filePath, 'utf8');
	const lines = content.split('\n').filter(Boolean);

	if (lines[0].split(',').filter(Boolean).length === 1 && lines[1]) lines.shift();

	const detectedHeaders = lines[0].split(',').map(h => h.trim());
	const likelyHasHeaders = detectedHeaders.filter(h => headerMap[normalizeHeader(h)]).length >= 2;

	let chapterFromFile = extractChapterFromFilename(path.basename(filePath));
	let hasChapterColumn = detectedHeaders.some(h => normalizeHeader(h) === 'chapter');
	let maxCP = 0,
		rows = [];

	await new Promise((resolve, reject) => {
		Readable.from(lines.join('\n'))
			.pipe(
				csv({
					headers: likelyHasHeaders ? undefined : fallbackHeaders,
					mapHeaders: likelyHasHeaders ? ({ header, index }) => headerMap[normalizeHeader(header)] || headerMap[index] || null : null,
				}),
			)
			.on('data', row => {
				const clean = { __source: path.basename(filePath, '.csv'), __line: rows.length + 1 };

				// If no headers, row keys are fallbackHeaders exactly, so normalize manually
				if (!likelyHasHeaders) {
					for (const keyRaw of fallbackHeaders) {
						const keyNorm = headerMap[normalizeHeader(keyRaw)] || null;
						if (!keyNorm) continue;
						const val = row[keyRaw];
						const transform = transformMap[keyNorm];
						clean[keyNorm] = transform ? transform(val) : val;
						if (keyNorm === 'chapter') hasChapterColumn = true;
					}
				} else {
					// With headers, keys already normalized by mapHeaders
					for (const [key, val] of Object.entries(row)) {
						if (!key) continue;
						const transform = transformMap[key];
						const v = transform ? transform(val) : val;
						if (key === 'chapter') hasChapterColumn = true;
						clean[key] = v;
					}
				}

				if (!hasChapterColumn || !clean.chapter) clean.chapter = chapterFromFile;
				if (!clean.name || !clean.description) return;
				if (clean.cost > maxCP) maxCP = clean.cost;
				rows.push(clean);
			})
			.on('end', resolve)
			.on('error', reject);
	});

	return { rows, maxCP };
}

/**
 * Splits out special chapters from the database and removes them from the main data.
 * Stores split chapter rows in global buckets so multiple folders cannot overwrite each other.
 * @param {Record<string, object[]>} database - The chapter-keyed database
 * @param {Record<string, object[]>} splitBuckets - Output filename-keyed split rows
 * @returns {void}
 */
function collectSplitRows(database, splitBuckets) {
	const allRows = Object.values(database).flat();
	for (const [chapterName, fileName] of Object.entries(SPLIT_CHAPTERS)) {
		const filtered = allRows.filter(r => r.chapter?.toLowerCase() === chapterName.toLowerCase());
		if (filtered.length) {
			splitBuckets[fileName] ||= [];
			splitBuckets[fileName].push(...filtered);
			console.log(`Queued split: ${filtered.length} rows from "${chapterName}"`);
		}
	}
	for (const key in database) {
		database[key] = database[key].filter(row => !SPLIT_CHAPTERS[row.chapter?.toLowerCase()]);
	}
}

/**
 * Writes all globally collected split chapter files.
 * @param {Record<string, object[]>} splitBuckets - Output filename-keyed split rows
 * @returns {Promise<void>}
 */
async function writeSplitFiles(splitBuckets) {
	for (const [fileName, rows] of Object.entries(splitBuckets).sort(([a], [b]) => a.localeCompare(b))) {
		await fs.promises.writeFile(path.join(OUT_ROOT, `${fileName}.json`), JSON.stringify({ 1: rows }, null, 2), 'utf8');
		console.log(`✅ Split: ${rows.length} rows to "${fileName}.json"`);
	}
}

/**
 * Main build function: parses all CSVs and MDs in SHEETS_ROOT, builds category JSON files, and splits special chapters.
 * @returns {Promise<void>}
 */
async function buildDatabase() {
	await fs.promises.mkdir(OUT_ROOT, { recursive: true });

	let globalMaxCP = 0;
	const splitBuckets = {};
	const folders = fs
		.readdirSync(SHEETS_ROOT, { withFileTypes: true })
		.filter(d => d.isDirectory())
		.map(d => d.name)
		.sort((a, b) => a.localeCompare(b));

	for (const folder of folders) {
		const db = {};
		const allFiles = fs.readdirSync(path.join(SHEETS_ROOT, folder)).sort((a, b) => a.localeCompare(b));
		const csvFiles = allFiles.filter(f => f.endsWith('.csv'));
		const mdFiles = allFiles.filter(f => f.endsWith('.md'));

		let fileIndex = 1;

		// Process CSV files
		const csvResults = await Promise.all(
			csvFiles.map(async file => {
				try {
					const { rows, maxCP } = await parseCsv(path.join(SHEETS_ROOT, folder, file));
					return { file, rows, maxCP };
				} catch (e) {
					console.error(`Error parsing ${file}:`, e);
					return null;
				}
			}),
		);

		for (const result of csvResults) {
			if (!result) continue;
			const { file, rows, maxCP } = result;
			if (!rows.length) {
				console.warn(`Skipping empty: ${folder}/${file}`);
				continue;
			}
			db[fileIndex++] = rows;
			if (maxCP > globalMaxCP) globalMaxCP = maxCP;
			console.log(`${folder}/${file} → ${rows.length} rows, max CP: ${maxCP}`);
		}

		// Process Markdown files
		const mdResults = await Promise.all(
			mdFiles.map(async file => {
				try {
					const { rows } = await parseMarkdown(path.join(SHEETS_ROOT, folder, file));
					const sourceName = path.basename(file, '.md');
					const rowsWithMetadata = rows.map((row, index) => ({
						__source: sourceName,
						__line: row.id ?? index + 1,
						...row,
					}));
					const maxCP = rowsWithMetadata.length ? Math.max(...rowsWithMetadata.map(r => (typeof r.cost === 'number' ? r.cost : 0))) : 0;
					return { file, rows: rowsWithMetadata, maxCP };
				} catch (e) {
					console.error(`Error parsing ${file}:`, e);
					return null;
				}
			}),
		);

		for (const result of mdResults) {
			if (!result) continue;
			const { file, rows, maxCP } = result;
			if (!rows.length) {
				console.warn(`Skipping empty: ${folder}/${file}`);
				continue;
			}
			db[fileIndex++] = rows;
			if (maxCP > globalMaxCP) globalMaxCP = maxCP;
			console.log(`${folder}/${file} → ${rows.length} rows, max CP: ${maxCP}`);
		}

		if (!Object.keys(db).length) continue;

		collectSplitRows(db, splitBuckets);
		await fs.promises.writeFile(path.join(OUT_ROOT, `${slugify(folder)}.json`), JSON.stringify(db, null, 2), 'utf8');
		console.log(`Wrote "${folder}"`);
	}
	await writeSplitFiles(splitBuckets);
	console.log(`Highest CP found: ${globalMaxCP}`);
}

if (require.main === module) {
	buildDatabase().catch(console.error);
}

module.exports = {
	buildDatabase,
	collectSplitRows,
	extractChapterFromFilename,
	normalizeHeader,
	parseCsv,
	writeSplitFiles,
};

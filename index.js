const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Readable } = require('stream');

const SHEETS_ROOT = path.join(__dirname, 'sheets');
const OUT_ROOT = path.join(__dirname, 'data');

/**
 * Maps raw CSV headers or column indices to standard field names.
 * Keys are lowercase alphanumeric versions of headers (or numeric indices).
 * @type {Record<string|number, string>}
 */
const headerMap = {
	0: 'id',
	unnamed0: 'id',
	cpcost: 'cost',
	cost: 'cost',
	price: 'cost',
	name: 'name',
	item: 'name',
	perkname: 'name',
	jump: 'source',
	jumpdoc: 'source',
	jumpchain: 'source',
	source: 'source',
	setting: 'source',
	chapter: 'chapter',
	category: 'chapter',
	description: 'description',
};

/**
 * Defines transformation functions applied to parsed CSV fields.
 * Keys are standard field names, values are functions that take raw values and return processed ones.
 * @type {Record<string, (value:any) => any>}
 */
const transformMap = {
	id: v => Number(String(v).replace(/cp$/i, '').trim()) || 0,
	cost: v => Number(String(v).replace(/cp$/i, '').trim()) || 0,
	description: v =>
		String(v ?? '')
			.replace(/[\r\t]+/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.replace(/(?<!\n)\n(?!\n)/g, ' ')
			.replace(/\s{2,}/g, ' ')
			.trim(),
	chapter: v => v?.trim(),
};

/**
 * Chapters that should be split into separate JSON files.
 * @type {Record<string, string>} key = chapter name (case-insensitive), value = output filename (without extension)
 */
const SPLIT_CHAPTERS = {
	'waifu catalogue': 'waifu',
	'lewd': 'companion_(lewd)',
};

/** @type {string[]} Fallback headers used if no CSV headers are detected */
const fallbackHeaders = ['CP Cost', 'Name', 'Jumpdoc', 'Description'];

/**
 * Normalizes a header by lowercasing and stripping non-alphabetic characters.
 * @param {string} h - Raw header
 * @returns {string|null} Normalized header or null if falsy
 */
const normalizeHeader = h => (h ? h.toLowerCase().replace(/[^a-z]/g, '') : null);

/**
 * Converts a string to a slug: lowercase, underscores instead of spaces, safe characters only.
 * @param {string} str - String to slugify
 * @returns {string}
 */
const slugify = str =>
	str
		.replace(/^Copy of\s*/i, '')
		.replace(/'/g, '')
		.replace(/\s+/g, '_')
		.replace(/[^\w-]+/g, '')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();

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
					mapHeaders: ({ header, index }) => headerMap[normalizeHeader(header)] || headerMap[index] || null,
				}),
			)
			.on('data', row => {
				const clean = { __source: path.basename(filePath, '.csv'), __line: rows.length + 1 };
				for (const [key, rawVal] of Object.entries(row)) {
					if (!key) continue;
					const transform = transformMap[key];
					const v = transform ? transform(rawVal) : rawVal;
					if (key === 'chapter') hasChapterColumn = true;
					clean[key] = v;
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
 * Writes each split chapter as a separate JSON file.
 * @param {Record<string, object[]>} database - The chapter-keyed database
 * @returns {Promise<void>}
 */
async function splitAndRemove(database) {
	const allRows = Object.values(database).flat();
	for (const [chapterName, fileName] of Object.entries(SPLIT_CHAPTERS)) {
		const filtered = allRows.filter(r => r.chapter?.toLowerCase() === chapterName.toLowerCase());
		if (filtered.length) {
			await fs.promises.writeFile(path.join(OUT_ROOT, `${fileName}.json`), JSON.stringify({ 1: filtered }, null, 2), 'utf8');
			console.log(`✅ Split: ${filtered.length} rows from "${chapterName}"`);
		}
	}
	for (const key in database) {
		database[key] = database[key].filter(row => !SPLIT_CHAPTERS[row.chapter?.toLowerCase()]);
	}
}

/**
 * Main build function: parses all CSVs in SHEETS_ROOT, builds category JSON files, and splits special chapters.
 * @returns {Promise<void>}
 */
async function buildDatabase() {
	let globalMaxCP = 0;
	const folders = fs
		.readdirSync(SHEETS_ROOT, { withFileTypes: true })
		.filter(d => d.isDirectory())
		.map(d => d.name);

	for (const folder of folders) {
		const db = {};
		const files = fs.readdirSync(path.join(SHEETS_ROOT, folder)).filter(f => f.endsWith('.csv'));

		await Promise.all(
			files.map(async (file, idx) => {
				try {
					const { rows, maxCP } = await parseCsv(path.join(SHEETS_ROOT, folder, file));
					if (!rows.length) return console.warn(`Skipping empty: ${folder}/${file}`);
					db[idx + 1] = rows;
					if (maxCP > globalMaxCP) globalMaxCP = maxCP;
					console.log(`${folder}/${file} → ${rows.length} rows, max CP: ${maxCP}`);
				} catch (e) {
					console.error(`Error parsing ${file}:`, e);
				}
			}),
		);

		if (!Object.keys(db).length) continue;

		await splitAndRemove(db);
		await fs.promises.writeFile(path.join(OUT_ROOT, `${slugify(folder)}.json`), JSON.stringify(db, null, 2), 'utf8');
		console.log(`Wrote "${folder}"`);
	}
	console.log(`Highest CP found: ${globalMaxCP}`);
}

buildDatabase().catch(console.error);

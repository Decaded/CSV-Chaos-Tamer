const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { parseMarkdown } = require('./md-parser');
const { shared, csv: csvConfig } = require('./config');

const SHEETS_ROOT = path.join(__dirname, 'sheets');
const OUT_ROOT = path.join(__dirname, 'data');
const ID_REGISTRY_PATH = path.join(__dirname, 'perk-id-registry.json');
const MACHINE_ID_RE = /^[a-z0-9_-]+$/;

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

function requireMachineId(value, fallback = 'unknown') {
	const id = slugify(value) || fallback;
	if (!MACHINE_ID_RE.test(id)) throw new Error(`Invalid machine ID generated from "${value}": ${id}`);
	return id;
}

function displayNameFromId(id) {
	return String(id)
		.split(/[_-]+/)
		.filter(Boolean)
		.map(part => (/^v\d+$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
		.join(' ');
}

function deriveCategoryVersion(folderName) {
	const database = requireMachineId(folderName);
	const versionMatch = database.match(/^(.+)_v(\d+)$/);
	const categoryId = versionMatch ? versionMatch[1] : database;
	const versionId = versionMatch ? `v${versionMatch[2]}` : 'default';
	const categoryDisplayName = displayNameFromId(categoryId);
	const versionDisplayName = versionId === 'default' ? categoryDisplayName : `${categoryDisplayName} ${versionId.toUpperCase()}`;

	return {
		categoryId,
		categoryDisplayName,
		versionId,
		versionDisplayName,
		database,
	};
}

function deriveSplitCategory(splitName) {
	const database = requireMachineId(splitName);
	const displayName = displayNameFromId(database);
	return {
		categoryId: database,
		categoryDisplayName: displayName,
		versionId: 'default',
		versionDisplayName: displayName,
		database,
	};
}

function sourceNameForRow(row, fallback) {
	return String(row.source || row.__source || fallback || 'Unknown Source').trim();
}

function normalizeCost(value) {
	if (typeof value === 'number') return Math.abs(value);
	const raw = String(value ?? '').trim();
	if (!raw || /free/i.test(raw)) return 0;
	if (/^(variable|special)(?:\s+cp)?$/i.test(raw)) return 0;
	const cleaned = raw
		.replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
		.replace(/[()[\]]/g, '')
		.replace(/cp|bp|kp/gi, '')
		.replace(/,/g, '')
		.trim();
	const parsed = Number(cleaned.match(/-?\d+(?:\.\d+)?/)?.[0]);
	return Number.isFinite(parsed) ? Math.abs(parsed) : Number.NaN;
}

function normalizeTags(value) {
	if (value === undefined || value === null || value === '') return [];
	if (Array.isArray(value)) return value.map(tag => String(tag).trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
	return String(value)
		.split(',')
		.map(tag => tag.trim())
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));
}

function isAdultRow(row, database) {
	if (typeof row.isAdult === 'boolean') return row.isAdult;
	const adultDatabases = new Set((shared.adultDatabases || []).map(requireMachineId));
	if (adultDatabases.has(database)) return true;
	return /\b(lewd|porn|bordello|debauchery)\b/i.test([row.chapter, row.source, row.__source].filter(Boolean).join(' '));
}

function logicalIdentityForRow(row, database) {
	const sourceFile = requireMachineId(row.__source || 'source');
	const rowId = Number.isFinite(row.id) && row.id > 0 ? `id_${row.id}` : `line_${row.__line || 0}`;
	return `${database}/${sourceFile}/${rowId}`;
}

function emptyRegistry() {
	return {
		version: 1,
		nextNumericId: 1,
		active: {},
		retired: {},
	};
}

function loadRegistry(registryPath = ID_REGISTRY_PATH) {
	if (!fs.existsSync(registryPath)) return emptyRegistry();
	const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
	return {
		...emptyRegistry(),
		...registry,
		active: registry.active || {},
		retired: registry.retired || {},
	};
}

function nextPerkId(registry, usedIds) {
	while (usedIds.has(`perk_${String(registry.nextNumericId).padStart(6, '0')}`)) {
		registry.nextNumericId += 1;
	}
	const id = `perk_${String(registry.nextNumericId).padStart(6, '0')}`;
	registry.nextNumericId += 1;
	return id;
}

function assignPerkIds(items, registry) {
	const usedIds = new Set([...Object.values(registry.active), ...Object.values(registry.retired)]);
	const activeIds = new Set(Object.values(registry.active));
	const seenKeys = new Map();
	let changedIdCount = 0;
	let reusedOrRetiredIdCount = 0;

	for (const item of items) {
		let logicalKey = item.logicalKey;
		const duplicateCount = seenKeys.get(logicalKey) || 0;
		seenKeys.set(logicalKey, duplicateCount + 1);
		if (duplicateCount) logicalKey = `${logicalKey}/occurrence_${duplicateCount + 1}`;
		item.logicalKey = logicalKey;

		if (registry.retired[logicalKey]) {
			reusedOrRetiredIdCount += 1;
			continue;
		}

		if (registry.active[logicalKey]) {
			item.perk.id = registry.active[logicalKey];
			if (usedIds.has(item.perk.id) && !activeIds.has(item.perk.id)) changedIdCount += 1;
			continue;
		}

		item.perk.id = nextPerkId(registry, usedIds);
		usedIds.add(item.perk.id);
		registry.active[logicalKey] = item.perk.id;
	}

	return { changedIdCount, reusedOrRetiredIdCount };
}

function retireMissingRegistryKeys(registry, currentKeys) {
	for (const [logicalKey, id] of Object.entries(registry.active)) {
		if (currentKeys.has(logicalKey)) continue;
		registry.retired[logicalKey] = id;
		delete registry.active[logicalKey];
	}
}

function sortObjectByKeys(obj) {
	return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

function prepareItems(databases) {
	const categoriesById = new Map();
	const sourceMetadataById = new Map();
	const items = [];

	for (const db of [...databases.values()].sort((a, b) => a.database.localeCompare(b.database))) {
		const category = categoriesById.get(db.categoryId) || {
			id: db.categoryId,
			displayName: db.categoryDisplayName,
			defaultVersion: 'default',
			versions: [],
		};
		if (!category.versions.some(version => version.id === db.versionId)) {
			category.versions.push({
				id: db.versionId,
				displayName: db.versionDisplayName,
				database: db.database,
			});
		}
		if (!category.versions.some(version => version.id === category.defaultVersion)) category.defaultVersion = db.versionId;
		categoriesById.set(db.categoryId, category);

		for (const row of db.rows) {
			const sourceName = sourceNameForRow(row, db.categoryDisplayName);
			const sourceId = `source_${requireMachineId(sourceName)}`;
			const chapter = String(row.chapter || 'Uncategorized').trim();
			const chapterKey = requireMachineId(chapter);
			const name = String(row.name || '').trim();
			const nameKey = requireMachineId(name);
			const description = String(row.description || '').trim();
			const sourceMetadata = sourceMetadataById.get(sourceId) || {
				id: sourceId,
				name: sourceName,
				displayName: sourceName,
				description: `Perks from ${sourceName}.`,
				categories: [],
			};
			if (!sourceMetadata.categories.includes(db.categoryId)) sourceMetadata.categories.push(db.categoryId);
			sourceMetadataById.set(sourceId, sourceMetadata);

			const perk = {
				id: null,
				cost: normalizeCost(row.cost),
				name,
				description,
				category: db.categoryId,
				categoryVersion: db.versionId,
				categoryDisplayName: db.versionDisplayName,
				tags: normalizeTags(row.tags),
				isAdult: isAdultRow(row, db.database),
			};

			items.push({
				database: db.database,
				sourceId,
				sourceName,
				sourceDescription: sourceMetadata.description,
				chapterKey,
				chapter,
				nameKey,
				rawCost: row.cost,
				logicalKey: logicalIdentityForRow(row, db.database),
				perk,
			});
		}
	}

	for (const category of categoriesById.values()) {
		category.versions.sort((a, b) => a.id.localeCompare(b.id));
	}
	for (const source of sourceMetadataById.values()) {
		source.categories.sort((a, b) => a.localeCompare(b));
	}

	items.sort(
		(a, b) =>
			a.perk.category.localeCompare(b.perk.category) ||
			a.perk.categoryVersion.localeCompare(b.perk.categoryVersion) ||
			a.sourceId.localeCompare(b.sourceId) ||
			a.chapterKey.localeCompare(b.chapterKey) ||
			a.nameKey.localeCompare(b.nameKey) ||
			a.logicalKey.localeCompare(b.logicalKey),
	);

	return {
		categories: [...categoriesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
		sources: [...sourceMetadataById.values()].sort((a, b) => a.id.localeCompare(b.id)),
		items,
	};
}

function buildPerkDatabases(items) {
	const grouped = {};

	for (const item of items) {
		grouped[item.database] ||= {};
		grouped[item.database][item.sourceId] ||= {
			source: item.sourceName,
			description: item.sourceDescription,
			chapters: {},
		};
		const source = grouped[item.database][item.sourceId];
		source.chapters[item.chapterKey] ||= {
			chapter: item.chapter,
			perks: {},
		};
		const chapter = source.chapters[item.chapterKey];
		chapter.perks[item.nameKey] ||= [];
		chapter.perks[item.nameKey].push(item.perk);
	}

	for (const database of Object.keys(grouped)) {
		grouped[database] = sortObjectByKeys(grouped[database]);
		for (const source of Object.values(grouped[database])) {
			source.chapters = sortObjectByKeys(source.chapters);
			for (const chapter of Object.values(source.chapters)) {
				chapter.perks = sortObjectByKeys(chapter.perks);
				for (const perks of Object.values(chapter.perks)) {
					perks.sort((a, b) => a.id.localeCompare(b.id));
				}
			}
		}
	}

	return grouped;
}

function validatePreparedData({ dataset, categories, sources, grouped, items, changedIdCount, reusedOrRetiredIdCount }) {
	const errors = [];
	const ids = new Set();
	const categoryVersions = new Map();
	const databases = new Set(Object.keys(grouped));
	const sourceIds = new Set(sources.map(source => source.id));
	const forbiddenCountFields = ['totalPerks', 'perkCount', 'adultCount', 'categoryCount', 'sourceCount', 'chapterCount'];

	for (const field of ['name', 'datasetVersion']) {
		if (!dataset[field]) errors.push(`Dataset metadata missing ${field}`);
	}
	for (const field of forbiddenCountFields) {
		if (Object.prototype.hasOwnProperty.call(dataset, field)) errors.push(`Dataset metadata contains count field ${field}`);
	}

	for (const category of categories) {
		if (!MACHINE_ID_RE.test(category.id)) errors.push(`Invalid category ID: ${category.id}`);
		if (!category.displayName) errors.push(`Category ${category.id} missing displayName`);
		if (!Array.isArray(category.versions) || !category.versions.length) errors.push(`Category ${category.id} has no versions`);
		const versionIds = new Set();
		for (const version of category.versions || []) {
			if (!MACHINE_ID_RE.test(version.id)) errors.push(`Invalid version ID: ${category.id}:${version.id}`);
			if (!MACHINE_ID_RE.test(version.database)) errors.push(`Invalid database ID: ${version.database}`);
			if (!databases.has(version.database)) errors.push(`Version ${category.id}:${version.id} references missing database ${version.database}`);
			if (versionIds.has(version.id)) errors.push(`Duplicate version ID: ${category.id}:${version.id}`);
			versionIds.add(version.id);
			categoryVersions.set(`${category.id}:${version.id}`, version);
		}
		if (!versionIds.has(category.defaultVersion)) errors.push(`Category ${category.id} defaultVersion is not a version`);
	}

	for (const source of sources) {
		if (!MACHINE_ID_RE.test(source.id)) errors.push(`Invalid source ID: ${source.id}`);
		for (const field of ['name', 'displayName', 'description']) {
			if (!source[field]) errors.push(`Source ${source.id} missing ${field}`);
		}
		if (!Array.isArray(source.categories)) errors.push(`Source ${source.id} categories is not an array`);
	}

	for (const item of items) {
		const perk = item.perk;
		if (!MACHINE_ID_RE.test(item.sourceId)) errors.push(`Invalid item source ID: ${item.sourceId}`);
		if (!MACHINE_ID_RE.test(item.chapterKey)) errors.push(`Invalid chapter key: ${item.chapterKey}`);
		if (!MACHINE_ID_RE.test(item.nameKey)) errors.push(`Invalid name key: ${item.nameKey}`);
		if (!sourceIds.has(item.sourceId)) errors.push(`Perk ${perk.id} references missing source ${item.sourceId}`);
		if (!MACHINE_ID_RE.test(perk.id || '')) errors.push(`Invalid perk ID: ${perk.id}`);
		if (ids.has(perk.id)) errors.push(`Duplicate perk ID: ${perk.id}`);
		ids.add(perk.id);
		if (!Number.isFinite(perk.cost) || perk.cost < 0) {
			errors.push(
				`Perk ${perk.id} has invalid cost: ${perk.cost} ` +
					`(${item.database}/${item.sourceId}/${item.chapterKey}/${item.nameKey}, raw: ${JSON.stringify(item.rawCost)})`,
			);
		}
		if (!perk.name) errors.push(`Perk ${perk.id} missing name`);
		if (!perk.description) errors.push(`Perk ${perk.id} missing description`);
		if (!categoryVersions.has(`${perk.category}:${perk.categoryVersion}`)) {
			errors.push(`Perk ${perk.id} references missing category version ${perk.category}:${perk.categoryVersion}`);
		}
		if (typeof perk.isAdult !== 'boolean') errors.push(`Perk ${perk.id} has non-boolean isAdult`);
		if (!Array.isArray(perk.tags) || perk.tags.some(tag => typeof tag !== 'string')) errors.push(`Perk ${perk.id} has invalid tags`);
	}

	for (const [database, sourcesById] of Object.entries(grouped)) {
		if (!MACHINE_ID_RE.test(database)) errors.push(`Invalid grouped database ID: ${database}`);
		for (const [sourceId, source] of Object.entries(sourcesById)) {
			if (!sourceIds.has(sourceId)) errors.push(`Grouped source missing metadata: ${sourceId}`);
			for (const [chapterKey, chapter] of Object.entries(source.chapters || {})) {
				if (!MACHINE_ID_RE.test(chapterKey)) errors.push(`Invalid grouped chapter key: ${chapterKey}`);
				for (const [nameKey, perks] of Object.entries(chapter.perks || {})) {
					if (!MACHINE_ID_RE.test(nameKey)) errors.push(`Invalid grouped name key: ${nameKey}`);
					if (!Array.isArray(perks)) errors.push(`Perk group is not an array: ${database}/${sourceId}/${chapterKey}/${nameKey}`);
				}
			}
		}
	}

	if (changedIdCount) errors.push(`Changed ID count since previous render: ${changedIdCount}`);
	if (reusedOrRetiredIdCount) errors.push(`Reused or retired ID count: ${reusedOrRetiredIdCount}`);

	return errors;
}

function reportPreparedData({ dataset, categories, sources, grouped, items, changedIdCount, reusedOrRetiredIdCount, validationErrorCount }) {
	const chapterKeys = new Set();
	let adultPerkCount = 0;
	for (const item of items) {
		if (item.perk.isAdult) adultPerkCount += 1;
		chapterKeys.add(`${item.sourceId}/${item.chapterKey}`);
	}
	const duplicateIdCount = items.length - new Set(items.map(item => item.perk.id)).size;

	return {
		datasetVersion: dataset.datasetVersion,
		perkCount: items.length,
		adultPerkCount,
		categoryCount: categories.length,
		sourceCount: sources.length,
		chapterCount: chapterKeys.size,
		duplicateIdCount,
		changedIdCountSincePreviousRender: changedIdCount,
		reusedOrRetiredIdCount,
		validationErrorCount,
		databaseCount: Object.keys(grouped).length,
	};
}

function writeNyaDbDatabases({ dataset, categories, sources, grouped }, logger = console) {
	const NyaDB = require('@decaded/nyadb');
	const nyadb = new NyaDB({
		formattingStyle: 'space',
		indentSize: 2,
		writeDebounce: 0,
		maxFileSize: 1024,
	});
	const databases = {
		dataset,
		categories: { categories },
		sources: { sources },
		...grouped,
	};

	for (const [name, contents] of Object.entries(databases).sort(([a], [b]) => a.localeCompare(b))) {
		if (!nyadb.exists(name)) nyadb.create(name);
		if (!nyadb.set(name, contents)) throw new Error(`Failed to write NyaDB database "${name}"`);
		logger.log(`Stored NyaDB database "${name}"`);
	}

	return Object.keys(databases).sort((a, b) => a.localeCompare(b));
}

async function readFolderRows(folder, sheetsRoot = SHEETS_ROOT, logger = console) {
	const folderPath = path.join(sheetsRoot, folder);
	const allFiles = fs.readdirSync(folderPath).sort((a, b) => a.localeCompare(b));
	const csvFiles = allFiles.filter(f => f.endsWith('.csv'));
	const mdFiles = allFiles.filter(f => f.endsWith('.md'));
	let maxCP = 0;
	const rows = [];

	const csvResults = await Promise.all(
		csvFiles.map(async file => {
			try {
				const parsed = await parseCsv(path.join(folderPath, file));
				return { file, ...parsed };
			} catch (e) {
				logger.error(`Error parsing ${file}:`, e);
				return null;
			}
		}),
	);

	for (const result of csvResults) {
		if (!result) continue;
		const { file, rows: parsedRows, maxCP: fileMaxCP } = result;
		if (!parsedRows.length) {
			logger.warn(`Skipping empty: ${folder}/${file}`);
			continue;
		}
		for (const row of parsedRows) rows.push(row);
		if (fileMaxCP > maxCP) maxCP = fileMaxCP;
		logger.log(`${folder}/${file} → ${parsedRows.length} rows, max CP: ${fileMaxCP}`);
	}

	const mdResults = await Promise.all(
		mdFiles.map(async file => {
			try {
				const { rows: parsedRows } = await parseMarkdown(path.join(folderPath, file));
				const sourceName = path.basename(file, '.md');
				const rowsWithMetadata = parsedRows.map((row, index) => ({
					__source: sourceName,
					__line: row.id ?? index + 1,
					...row,
				}));
				const fileMaxCP = rowsWithMetadata.length ? Math.max(...rowsWithMetadata.map(r => normalizeCost(r.cost) || 0)) : 0;
				return { file, rows: rowsWithMetadata, maxCP: fileMaxCP };
			} catch (e) {
				logger.error(`Error parsing ${file}:`, e);
				return null;
			}
		}),
	);

	for (const result of mdResults) {
		if (!result) continue;
		const { file, rows: parsedRows, maxCP: fileMaxCP } = result;
		if (!parsedRows.length) {
			logger.warn(`Skipping empty: ${folder}/${file}`);
			continue;
		}
		for (const row of parsedRows) rows.push(row);
		if (fileMaxCP > maxCP) maxCP = fileMaxCP;
		logger.log(`${folder}/${file} → ${parsedRows.length} rows, max CP: ${fileMaxCP}`);
	}

	return { rows, maxCP };
}

/**
 * Main build function: parses all CSVs and MDs in SHEETS_ROOT and writes contract-shaped dataset files.
 * @returns {Promise<void>}
 */
async function buildDatabase(options = {}) {
	const sheetsRoot = options.sheetsRoot || SHEETS_ROOT;
	const outRoot = options.outRoot || OUT_ROOT;
	const registryPath = options.registryPath || ID_REGISTRY_PATH;
	const logger = options.logger || console;
	const writeFiles = options.writeFiles !== false;
	const writeRegistry = options.writeRegistry !== false;
	const retireMissing = options.retireMissing !== false;
	const writeNyaDb = options.writeNyaDb === true;

	if (writeFiles) await fs.promises.mkdir(outRoot, { recursive: true });

	let globalMaxCP = 0;
	const databases = new Map();
	const folders = fs
		.readdirSync(sheetsRoot, { withFileTypes: true })
		.filter(d => d.isDirectory())
		.map(d => d.name)
		.sort((a, b) => a.localeCompare(b));

	for (const folder of folders) {
		const category = deriveCategoryVersion(folder);
		const { rows, maxCP } = await readFolderRows(folder, sheetsRoot, logger);
		if (maxCP > globalMaxCP) globalMaxCP = maxCP;
		if (!rows.length) continue;

		for (const row of rows) {
			const splitName = SPLIT_CHAPTERS[row.chapter?.toLowerCase()];
			const target = splitName ? deriveSplitCategory(splitName) : category;
			const db = databases.get(target.database) || { ...target, rows: [] };
			db.rows.push(row);
			databases.set(target.database, db);
		}
	}

	const dataset = { ...shared.dataset };
	const registry = loadRegistry(registryPath);
	const prepared = prepareItems(databases);
	const idStats = assignPerkIds(prepared.items, registry);
	const grouped = buildPerkDatabases(prepared.items);
	const validationErrors = validatePreparedData({
		dataset,
		...prepared,
		grouped,
		...idStats,
	});
	const report = reportPreparedData({
		dataset,
		...prepared,
		grouped,
		...idStats,
		validationErrorCount: validationErrors.length,
	});

	if (validationErrors.length) {
		logger.error(JSON.stringify(report, null, 2));
		throw new Error(`Prepared data failed validation:\n${validationErrors.slice(0, 25).join('\n')}`);
	}

	if (retireMissing) retireMissingRegistryKeys(registry, new Set(prepared.items.map(item => item.logicalKey)));

	if (writeFiles) {
		await fs.promises.writeFile(path.join(outRoot, 'dataset.json'), JSON.stringify(dataset, null, 2), 'utf8');
		await fs.promises.writeFile(path.join(outRoot, 'categories.json'), JSON.stringify({ categories: prepared.categories }, null, 2), 'utf8');
		await fs.promises.writeFile(path.join(outRoot, 'sources.json'), JSON.stringify({ sources: prepared.sources }, null, 2), 'utf8');
		for (const [database, contents] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
			await fs.promises.writeFile(path.join(outRoot, `${database}.json`), JSON.stringify(contents, null, 2), 'utf8');
			logger.log(`Wrote "${database}"`);
		}
	}

	if (writeNyaDb) {
		const nyaDbList = writeNyaDbDatabases(
			{
				dataset,
				categories: prepared.categories,
				sources: prepared.sources,
				grouped,
			},
			logger,
		);
		report.nyaDbDatabaseCount = nyaDbList.length;
	}

	if (writeRegistry) await fs.promises.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');
	logger.log(JSON.stringify(report, null, 2));
	logger.log(`Highest CP found: ${globalMaxCP}`);
	return {
		report,
		outRoot,
		registryPath,
		databases: Object.keys(grouped).sort((a, b) => a.localeCompare(b)),
	};
}

if (require.main === module) {
	buildDatabase().catch(console.error);
}

module.exports = {
	buildDatabase,
	collectSplitRows,
	deriveCategoryVersion,
	deriveSplitCategory,
	extractChapterFromFilename,
	buildPerkDatabases,
	normalizeHeader,
	normalizeCost,
	prepareItems,
	parseCsv,
	validatePreparedData,
	writeNyaDbDatabases,
	writeSplitFiles,
};

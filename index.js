const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
	if (Array.isArray(value))
		return value
			.map(tag => String(tag).trim())
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b));
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
			item.perk.id = nextPerkId(registry, usedIds);
			usedIds.add(item.perk.id);
			delete registry.retired[logicalKey];
			registry.active[logicalKey] = item.perk.id;
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

function uuidForLogicalKey(logicalKey) {
	const bytes = crypto.createHash('sha1').update(`celestial-gambler/${logicalKey}`).digest().subarray(0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function disambiguateLogicalKeys(items) {
	const occurrences = new Map();
	for (const item of items) {
		const occurrence = occurrences.get(item.logicalKey) || 0;
		occurrences.set(item.logicalKey, occurrence + 1);
		if (occurrence) item.logicalKey = `${item.logicalKey}/occurrence_${occurrence + 1}`;
	}
}

function buildBackendGeneratorFiles(items, sourceGroups = shared.sourceVersions) {
	const files = {};

	for (const item of items) {
		const { database, chapter, sourceName } = item;
		files[database] ||= {};
		files[database][chapter] ||= [];
		files[database][chapter].push({
			id: uuidForLogicalKey(item.logicalKey),
			category: database,
			chapter,
			name: item.perk.name,
			cost: item.perk.cost,
			description: item.perk.description,
			source: sourceName,
		});
	}

	for (const chapters of Object.values(files)) {
		for (const perks of Object.values(chapters)) perks.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
	}

	const sourceMetadata = buildSourceMetadata(files, items, sourceGroups);
	return {
		files: sortObjectByKeys(Object.fromEntries(Object.entries(files).map(([database, chapters]) => [database, sortObjectByKeys(chapters)]))),
		sourceMetadata: { schemaVersion: 1, sources: sourceMetadata },
	};
}

function buildSourceMetadata(files, items, configuredGroups = shared.sourceVersions || {}) {
	const groupedDatabases = new Set();
	const sources = [];
	const itemsByDatabase = new Map();
	for (const item of items) {
		const databaseItems = itemsByDatabase.get(item.database) || [];
		databaseItems.push(item);
		itemsByDatabase.set(item.database, databaseItems);
	}

	for (const [sourceId, group] of Object.entries(configuredGroups)) {
		if (!MACHINE_ID_RE.test(sourceId) || !group || typeof group !== 'object') throw new Error(`Invalid source version group ${sourceId}`);
		const versions = Object.entries(group.versions || {});
		if (!versions.length || !versions.some(([version]) => version === group.defaultVersion)) throw new Error(`Source version group ${sourceId} must include its defaultVersion`);
		for (const [version, database] of versions) {
			if (!MACHINE_ID_RE.test(version) || typeof database !== 'string' || !Object.hasOwn(files, database)) {
				throw new Error(`Source version group ${sourceId} maps ${version} to an unknown database`);
			}
			if (groupedDatabases.has(database)) throw new Error(`Database ${database} is mapped to more than one source version group`);
			groupedDatabases.add(database);
		}
		const groupItems = versions.flatMap(([, database]) => itemsByDatabase.get(database) || []);
		sources.push({
			id: sourceId,
			displayName: group.displayName || displayNameFromId(sourceId),
			description: group.description || `Perks from ${group.displayName || displayNameFromId(sourceId)}.`,
			isR18: groupItems.some(item => item.perk.isAdult),
			defaultVersion: group.defaultVersion,
			categories: versions.map(([version, id]) => ({ id, version })),
		});
	}

	const standaloneVersionDatabases = new Map();
	for (const database of Object.keys(files)) {
		if (groupedDatabases.has(database)) continue;
		const versionMatch = database.match(/^(.+)_v(\d+)$/);
		if (!versionMatch || Object.hasOwn(files, versionMatch[1])) continue;
		const databases = standaloneVersionDatabases.get(versionMatch[1]) || [];
		databases.push({ database, version: `v${versionMatch[2]}` });
		standaloneVersionDatabases.set(versionMatch[1], databases);
	}

	for (const database of Object.keys(files)) {
		if (groupedDatabases.has(database)) continue;
		const databaseItems = itemsByDatabase.get(database) || [];
		const versionMatch = database.match(/^(.+)_v(\d+)$/);
		const baseId = versionMatch?.[1];
		const standaloneVersion = baseId && standaloneVersionDatabases.get(baseId)?.length === 1 ? `v${versionMatch[2]}` : null;
		const sourceId = standaloneVersion ? baseId : database;
		const displayName = standaloneVersion ? displayNameFromId(baseId) : databaseItems[0]?.perk.categoryDisplayName || displayNameFromId(database);
		sources.push({
			id: sourceId,
			displayName,
			description: `Perks from ${displayName}.`,
			isR18: databaseItems.some(item => item.perk.isAdult),
			defaultVersion: standaloneVersion || 'default',
			categories: [{ id: database, version: standaloneVersion || 'default' }],
		});
	}

	return sources.sort((left, right) => left.id.localeCompare(right.id));
}

function validateBackendGeneratorFiles({ files, sourceMetadata }) {
	const errors = [];
	const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	const categories = new Set(Object.keys(files));
	const mappedCategories = new Set();
	const ids = new Set();

	for (const source of sourceMetadata.sources) {
		if (!MACHINE_ID_RE.test(source.id) || !source.displayName || !source.description || typeof source.isR18 !== 'boolean' || typeof source.defaultVersion !== 'string') {
			errors.push(`Invalid source metadata for ${source.id}`);
		}
		if (!source.categories.some(category => category.version === source.defaultVersion)) errors.push(`Source ${source.id} has no mapped default version`);
		for (const category of source.categories) {
			if (!categories.has(category.id) || !MACHINE_ID_RE.test(category.version) || mappedCategories.has(category.id))
				errors.push(`Invalid source category mapping for ${category.id}`);
			mappedCategories.add(category.id);
		}
	}

	for (const [category, chapters] of Object.entries(files)) {
		if (!Object.keys(chapters).length) errors.push(`Category ${category} has no chapters`);
		for (const [chapter, perks] of Object.entries(chapters)) {
			if (!Array.isArray(perks)) errors.push(`Category ${category}, chapter ${chapter} is not an array`);
			for (const perk of perks) {
				if (!uuidPattern.test(perk.id) || ids.has(perk.id)) errors.push(`Invalid or duplicate perk UUID ${perk.id}`);
				ids.add(perk.id);
				if (perk.category !== category || perk.chapter !== chapter || !perk.name || !perk.description || !perk.source || !Number.isFinite(perk.cost) || perk.cost < 0) {
					errors.push(`Invalid perk ${perk.id}`);
				}
			}
		}
	}

	for (const category of categories) {
		if (!mappedCategories.has(category)) errors.push(`Category ${category} is missing source metadata`);
	}
	return errors;
}

function writeBackendNyaDb({ files, sourceMetadata }, logger = console) {
	const NyaDB = require('@decaded/nyadb');
	const nyadb = new NyaDB({
		formattingStyle: 'space',
		indentSize: 2,
		writeDebounce: 0,
		maxFileSize: 1024,
	});
	const databases = {
		generatorSources: Object.fromEntries(sourceMetadata.sources.map(source => [source.id, source])),
	};
	for (const [sourceId, chapters] of Object.entries(files)) {
		databases[`perks_${sourceId}`] = Object.fromEntries(
			Object.values(chapters)
				.flat()
				.map(perk => [perk.id, perk]),
		);
	}

	for (const name of nyadb.getList()) {
		if (!Object.hasOwn(databases, name)) nyadb.delete(name);
	}
	for (const [name, contents] of Object.entries(databases)) {
		if (nyadb.exists(name)) nyadb.clear(name);
		else nyadb.create(name);
		if (!nyadb.set(name, contents)) throw new Error(`Failed to write database "${name}"`);
		logger.log(`Stored database "${name}"`);
	}
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
				`Perk ${perk.id} has invalid cost: ${perk.cost} ` + `(${item.database}/${item.sourceId}/${item.chapterKey}/${item.nameKey}, raw: ${JSON.stringify(item.rawCost)})`,
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

function listFromPayload(payload, key) {
	if (Array.isArray(payload)) return payload;
	if (!payload || typeof payload !== 'object') return [];
	const value = key ? payload[key] : payload;
	if (Array.isArray(value)) return value;
	if (value && typeof value === 'object') return Object.values(value);
	return [];
}

function mergeCategoryPayload(existingPayload, incomingPayload) {
	const existing = listFromPayload(existingPayload, 'categories');
	const incoming = listFromPayload(incomingPayload, 'categories');
	const byId = new Map();

	for (const category of existing) {
		if (!category?.id) continue;
		const versions = new Map((category.versions || []).filter(v => v?.id).map(v => [v.id, { ...v }]));
		byId.set(category.id, {
			...category,
			versions,
		});
	}

	for (const category of incoming) {
		if (!category?.id) continue;
		const current = byId.get(category.id) || { id: category.id, versions: new Map() };
		const merged = {
			...current,
			...category,
			versions: current.versions,
		};
		for (const version of category.versions || []) {
			if (!version?.id) continue;
			merged.versions.set(version.id, { ...(merged.versions.get(version.id) || {}), ...version });
		}
		byId.set(category.id, merged);
	}

	const categories = [...byId.values()]
		.map(category => ({
			...category,
			versions: [...category.versions.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
		}))
		.sort((a, b) => String(a.id).localeCompare(String(b.id)));

	return { categories };
}

function mergeSourcePayload(existingPayload, incomingPayload) {
	const existing = listFromPayload(existingPayload, 'sources');
	const incoming = listFromPayload(incomingPayload, 'sources');
	const byId = new Map();

	for (const source of existing) {
		if (!source?.id) continue;
		byId.set(source.id, {
			...source,
			categories: [...new Set((source.categories || []).map(String))].sort((a, b) => a.localeCompare(b)),
		});
	}

	for (const source of incoming) {
		if (!source?.id) continue;
		const current = byId.get(source.id) || {};
		const categories = [...new Set([...(current.categories || []), ...(source.categories || [])].map(String))].sort((a, b) => a.localeCompare(b));
		byId.set(source.id, {
			...current,
			...source,
			categories,
		});
	}

	return {
		sources: [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
	};
}

function mergePerkPayload(existingPayload, incomingPayload) {
	const existing = existingPayload && typeof existingPayload === 'object' ? existingPayload : {};
	const incoming = incomingPayload && typeof incomingPayload === 'object' ? incomingPayload : {};
	const merged = { ...existing };

	for (const [sourceId, incomingSource] of Object.entries(incoming)) {
		if (sourceId === 'metadata' || sourceId === '_metadata') {
			merged[sourceId] = {
				...(existing[sourceId] && typeof existing[sourceId] === 'object' ? existing[sourceId] : {}),
				...(incomingSource && typeof incomingSource === 'object' ? incomingSource : {}),
			};
			continue;
		}

		const existingSource = existing[sourceId] && typeof existing[sourceId] === 'object' ? existing[sourceId] : {};
		const existingChapters = existingSource.chapters && typeof existingSource.chapters === 'object' ? existingSource.chapters : {};
		const incomingChapters = incomingSource?.chapters && typeof incomingSource.chapters === 'object' ? incomingSource.chapters : {};
		const chapters = { ...existingChapters };

		for (const [chapterKey, incomingChapter] of Object.entries(incomingChapters)) {
			const existingChapter = existingChapters[chapterKey] && typeof existingChapters[chapterKey] === 'object' ? existingChapters[chapterKey] : {};
			const existingPerks = existingChapter.perks && typeof existingChapter.perks === 'object' ? existingChapter.perks : {};
			const incomingPerks = incomingChapter?.perks && typeof incomingChapter.perks === 'object' ? incomingChapter.perks : {};
			chapters[chapterKey] = {
				...existingChapter,
				...incomingChapter,
				perks: {
					...existingPerks,
					...incomingPerks,
				},
			};
		}

		merged[sourceId] = {
			...existingSource,
			...incomingSource,
			chapters,
		};
	}

	return merged;
}

function mergeNyaDbContents(name, existingContents, incomingContents) {
	if (!existingContents || typeof existingContents !== 'object') return incomingContents;
	if (name === 'dataset') return { ...existingContents, ...(incomingContents || {}) };
	if (name === 'categories') return mergeCategoryPayload(existingContents, incomingContents);
	if (name === 'sources') return mergeSourcePayload(existingContents, incomingContents);
	return mergePerkPayload(existingContents, incomingContents);
}

function writeNyaDbDatabases({ dataset, categories, sources, grouped }, logger = console, options = {}) {
	const mergeExisting = options.mergeExisting === true;
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
		const exists = nyadb.exists(name);
		if (!exists) nyadb.create(name);
		const existingContents = mergeExisting && exists ? nyadb.get(name) : null;
		const nextContents = mergeExisting ? mergeNyaDbContents(name, existingContents, contents) : contents;
		if (!nyadb.set(name, nextContents)) throw new Error(`Failed to write database "${name}"`);
		logger.log(`Stored database "${name}"`);
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
 * Main build function: parses all CSVs and MDs in SHEETS_ROOT into backend-compatible NyaDB records.
 * @returns {Promise<void>}
 */
async function buildDatabase(options = {}) {
	const sheetsRoot = options.sheetsRoot || SHEETS_ROOT;
	const logger = options.logger || console;
	const writeNyaDb = options.writeNyaDb !== false;

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

	const prepared = prepareItems(databases);
	disambiguateLogicalKeys(prepared.items);
	const output = buildBackendGeneratorFiles(prepared.items);
	const validationErrors = validateBackendGeneratorFiles(output);
	const report = {
		perkCount: prepared.items.length,
		categoryCount: Object.keys(output.files).length,
		sourceCount: output.sourceMetadata.sources.length,
		validationErrorCount: validationErrors.length,
	};

	if (validationErrors.length) {
		logger.error(JSON.stringify(report, null, 2));
		throw new Error(`Prepared data failed validation:\n${validationErrors.slice(0, 25).join('\n')}`);
	}

	if (writeNyaDb) writeBackendNyaDb(output, logger);
	logger.log(JSON.stringify(report, null, 2));
	logger.log(`Highest CP found: ${globalMaxCP}`);
	return {
		report,
		databases: Object.keys(output.files),
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
	buildBackendGeneratorFiles,
	buildSourceMetadata,
	disambiguateLogicalKeys,
	normalizeHeader,
	normalizeCost,
	assignPerkIds,
	prepareItems,
	parseCsv,
	mergeNyaDbContents,
	validatePreparedData,
	validateBackendGeneratorFiles,
	writeBackendNyaDb,
	writeNyaDbDatabases,
	writeSplitFiles,
};

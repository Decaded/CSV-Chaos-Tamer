const fs = require('fs');
const path = require('path');

const { parseMarkdown } = require('./parsers/md-parser');
const { shared } = require('./config/settings');
const { loadDatasetConfig } = require('./config/dataset');

const { deriveSourceEdition, deriveSplitEdition, normalizeCost } = require('./helpers');
const { normalizeHeader, extractChapterFromFilename, parseCsv } = require('./parsers/parse-csv');
const { updateSourceR18Flags } = require('./registry/keywords');
const { ID_REGISTRY_PATH, loadRegistry, assignPerkIds, retireMissingRegistryKeys } = require('./registry/perk-registry');
const { prepareItems, buildPerkDatabases, disambiguateLogicalKeys } = require('./build/prepare-items');
const { buildBackendGeneratorFiles, buildFileEditions, buildSourceMetadata } = require('./build/generator-files');
const { loadSourceMetadataConfig, deriveSourceEditionsConfig, validateSourceMetadataConfig, applySourceMetadataOverrides } = require('./build/source-metadata');
const { validateBackendGeneratorFiles, validatePreparedData } = require('./build/validate');
const { reportPreparedData } = require('./build/report');
const { writeNyaDbDatabases } = require('./nyadb/nyadb-writer');

const SOURCES_ROOT = path.join(__dirname, '..', 'sources');
const SPLIT_CHAPTERS = shared.splitChapters;

async function readFolderRows(folder, sheetsRoot = SOURCES_ROOT, logger = console) {
	const folderPath = path.join(sheetsRoot, folder);
	const allFiles = fs.readdirSync(folderPath).sort((a, b) => a.localeCompare(b));
	const csvFiles = allFiles.filter(f => f.endsWith('.csv'));
	const mdFiles = allFiles.filter(f => f.endsWith('.md'));
	let maxCP = 0;
	const rows = [];
	const skippedFiles = [];

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
			skippedFiles.push(`${folder}/${file}`);
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
					__origin: sourceName,
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
			skippedFiles.push(`${folder}/${file}`);
			continue;
		}
		for (const row of parsedRows) rows.push(row);
		if (fileMaxCP > maxCP) maxCP = fileMaxCP;
		logger.log(`${folder}/${file} → ${parsedRows.length} rows, max CP: ${fileMaxCP}`);
	}

	return { rows, maxCP, skippedFiles };
}

/**
 * Main build function: parses all CSVs and MDs in the sources folder into backend-compatible NyaDB records.
 * @returns {Promise<void>}
 */
async function buildDatabase(options = {}) {
	const sheetsRoot = options.sheetsRoot || SOURCES_ROOT;
	const logger = options.logger || console;
	const writeNyaDb = options.writeNyaDb === true;
	const registryPath = options.registryPath || ID_REGISTRY_PATH;
	const retireMissing = options.retireMissing !== false;
	const sourceMetadataConfigPath = options.sourceMetadataConfigPath;
	const datasetConfigPath = options.datasetConfigPath;
	const manualSourceMetadata = loadSourceMetadataConfig(sourceMetadataConfigPath);
	const sourceGroups = options.sourceGroups || deriveSourceEditionsConfig(manualSourceMetadata);

	let globalMaxCP = 0;
	const databases = new Map();
	const skippedFiles = [];
	const folders = fs
		.readdirSync(sheetsRoot, { withFileTypes: true })
		.filter(d => d.isDirectory())
		.map(d => d.name)
		.sort((a, b) => a.localeCompare(b));

	for (const folder of folders) {
		const sourceEdition = deriveSourceEdition(folder);
		const { rows, maxCP, skippedFiles: folderSkipped } = await readFolderRows(folder, sheetsRoot, logger);
		skippedFiles.push(...folderSkipped);
		if (maxCP > globalMaxCP) globalMaxCP = maxCP;
		if (!rows.length) continue;

		for (const row of rows) {
			const splitName = SPLIT_CHAPTERS[row.chapter?.toLowerCase()];
			const target = splitName ? deriveSplitEdition(splitName) : sourceEdition;
			const db = databases.get(target.fileKey) || { ...target, rows: [] };
			db.rows.push(row);
			databases.set(target.fileKey, db);
		}
	}

	const prepared = prepareItems(databases);
	disambiguateLogicalKeys(prepared.items);

	const registry = loadRegistry(registryPath);
	const { changedIdCount, reusedOrRetiredIdCount } = assignPerkIds(prepared.items, registry);
	if (retireMissing) retireMissingRegistryKeys(registry, new Set(prepared.items.map(item => item.logicalKey)));
	let registryChanged = false;
	if (writeNyaDb) {
		const content = JSON.stringify(registry, null, 2);
		registryChanged = !fs.existsSync(registryPath) || fs.readFileSync(registryPath, 'utf8') !== content;
		fs.mkdirSync(path.dirname(registryPath), { recursive: true });
		fs.writeFileSync(registryPath, content, 'utf8');
	}

	const output = buildBackendGeneratorFiles(prepared.items, sourceGroups);
	const grouped = buildPerkDatabases(prepared.items);
	applySourceMetadataOverrides(output.sourceMetadata.sources, manualSourceMetadata);
	updateSourceR18Flags(output.sourceMetadata.sources);
	const validationErrors = [...validateBackendGeneratorFiles(output), ...validateSourceMetadataConfig(output.sourceMetadata.sources, manualSourceMetadata)];
	const report = reportPreparedData({
		dataset: loadDatasetConfig(datasetConfigPath),
		sources: output.sourceMetadata.sources,
		origins: prepared.origins,
		grouped,
		items: prepared.items,
		changedIdCount,
		reusedOrRetiredIdCount,
		validationErrorCount: validationErrors.length,
	});

	if (validationErrors.length) {
		logger.error(JSON.stringify(report, null, 2));
		const err = new Error(`Prepared data failed validation:\n${validationErrors.slice(0, 25).join('\n')}`);
		err.validationErrors = validationErrors;
		err.report = report;
		throw err;
	}

	let writtenDatabases = { changed: [], unchanged: [], deleted: [] };
	if (writeNyaDb) {
		const writeDatabases = options.writeNyaDbDatabases || writeNyaDbDatabases;
		writtenDatabases = await writeDatabases({ files: output.files, sourceMetadata: output.sourceMetadata }, logger);
	}
	logger.log(JSON.stringify(report, null, 2));
	logger.log(`Highest CP found: ${globalMaxCP}`);
	if (skippedFiles.length) {
		logger.warn(`Skipped ${skippedFiles.length} empty file(s) — their contents were NOT added to the database:`);
		for (const file of skippedFiles) logger.warn(`  - ${file}`);
	}
	return {
		report,
		databases: Object.keys(output.files),
		writtenDatabases,
		registryChanged,
		skippedFiles,
	};
}

if (require.main === module) {
	buildDatabase().catch(console.error);
}

module.exports = {
	buildDatabase,
	deriveSourceEdition,
	deriveSplitEdition,
	extractChapterFromFilename,
	buildPerkDatabases,
	buildBackendGeneratorFiles,
	buildFileEditions,
	buildSourceMetadata,
	disambiguateLogicalKeys,
	normalizeHeader,
	normalizeCost,
	assignPerkIds,
	prepareItems,
	parseCsv,
	validatePreparedData,
	validateBackendGeneratorFiles,
	loadSourceMetadataConfig,
	deriveSourceEditionsConfig,
	validateSourceMetadataConfig,
	applySourceMetadataOverrides,
	updateSourceR18Flags,
};

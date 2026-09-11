const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const { buildDatabase } = require('./src/index');
const { buildFailureReport } = require('./src/diagnostics');
const { ID_REGISTRY_PATH } = require('./src/registry/perk-registry');
const lockApi = require('./src/lock');

const DEFAULT_SOURCES_ROOT = path.join(__dirname, 'sources');
const DEFAULT_NYADB_ROOT = path.resolve(process.cwd(), 'NyaDB');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'src', 'config', 'source-metadata.config.json');
const DEFAULT_KEYWORD_FILTER_PATH = path.join(__dirname, 'src', 'config', 'keyword-filter.json');
const DEFAULT_PUBLIC_ROOT = path.join(__dirname, 'public');
const DEFAULT_LOCK_PATH = path.join(__dirname, '.nya-build.lock');

const PORT = Number(process.env.CSV_TAMER_PORT || 3000);
const HOST = process.env.CSV_TAMER_HOST || '127.0.0.1';
const MAX_BODY_BYTES = Number(process.env.CSV_TAMER_MAX_BODY || 64 * 1024 * 1024);

function envPath(name, fallback) {
	const value = process.env[name];
	return value ? path.resolve(value) : fallback;
}

const CONFIG = {
	sourcesRoot: envPath('CSV_TAMER_SOURCES_ROOT', DEFAULT_SOURCES_ROOT),
	nyaDbRoot: envPath('CSV_TAMER_NYADB_ROOT', DEFAULT_NYADB_ROOT),
	sourceMetadataConfigPath: envPath('CSV_TAMER_SOURCE_METADATA_CONFIG', DEFAULT_CONFIG_PATH),
	keywordFilterPath: envPath('CSV_TAMER_KEYWORD_FILTER_CONFIG', DEFAULT_KEYWORD_FILTER_PATH),
	registryPath: envPath('CSV_TAMER_REGISTRY_PATH', ID_REGISTRY_PATH),
	publicRoot: envPath('CSV_TAMER_PUBLIC_ROOT', DEFAULT_PUBLIC_ROOT),
	lockPath: envPath('CSV_TAMER_LOCK_FILE', DEFAULT_LOCK_PATH),
	host: HOST,
	port: PORT,
	maxBodyBytes: MAX_BODY_BYTES,
};

const MIME_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
};

function sendJson(res, statusCode, payload) {
	const body = JSON.stringify(payload, null, 2);
	res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
	res.end(body);
}

function sendText(res, statusCode, message) {
	res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
	res.end(message);
}

async function readJsonBody(req, maxBytes) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > maxBytes) {
			throw new Error(`Request body exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
		}
		chunks.push(chunk);
	}
	if (!total) return {};
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch (error) {
		throw new Error('Body must be valid JSON');
	}
}

function safeDatabaseName(value) {
	const name = String(value || '').trim();
	if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
		throw Object.assign(new Error('Database name must use letters, numbers, underscores, or dashes'), { status: 400 });
	}
	return name;
}

function toArray(value, fallbackKey) {
	if (Array.isArray(value)) return value;
	if (!value || typeof value !== 'object') return [];
	if (Array.isArray(value[fallbackKey])) return value[fallbackKey];
	return Object.values(value);
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readRawBody(req, maxBytes) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > maxBytes) {
			throw new Error(`Request body exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

function safeSourceFolder(value) {
	const name = String(value || '').trim();
	if (!name || name === '.' || name === '..' || name.startsWith('.') || /[\/\\\0]/.test(name)) {
		throw Object.assign(new Error('Source folder name is invalid'), { status: 400 });
	}
	return name;
}

function safeSourceFileName(value) {
	const name = String(value || '').trim();
	if (!name || name === '.' || name === '..' || /[\/\\\0]/.test(name) || !/\.(csv|md)$/i.test(name)) {
		throw Object.assign(new Error('Source file must end in .csv or .md'), { status: 400 });
	}
	return name;
}

function createLogger(onEntry) {
	const entries = [];
	const push = (level, values) => {
		const message = values
			.map(value => {
				if (value instanceof Error) return value.stack || value.message;
				if (typeof value === 'string') return value;
				try {
					return JSON.stringify(value);
				} catch {
					return String(value);
				}
			})
			.join(' ');
		const entry = { level, message };
		entries.push(entry);
		if (onEntry) onEntry(entry);
	};
	return {
		entries,
		log: (...values) => push('info', values),
		warn: (...values) => push('warn', values),
		error: (...values) => push('error', values),
	};
}

function listDatabaseFiles(nyaDbRoot) {
	if (!fs.existsSync(nyaDbRoot)) return [];
	return fs
		.readdirSync(nyaDbRoot, { withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
		.map(entry => {
			const filePath = path.join(nyaDbRoot, entry.name);
			return { name: entry.name.slice(0, -'.json'.length), bytes: fs.statSync(filePath).size };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

function readDatabase(nyaDbRoot, name) {
	const filePath = path.join(nyaDbRoot, `${name}.json`);
	if (!fs.existsSync(filePath)) return null;
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeDatabase(nyaDbRoot, name, contents) {
	if (!isPlainObject(contents)) {
		throw new Error('Dataset contents must be a JSON object');
	}
	if (!fs.existsSync(nyaDbRoot)) {
		fs.mkdirSync(nyaDbRoot, { recursive: true });
	}
	const filePath = path.join(nyaDbRoot, `${name}.json`);
	const tmpPath = `${filePath}.tmp-${process.pid}`;
	fs.writeFileSync(tmpPath, JSON.stringify(contents, null, 2), 'utf8');
	fs.renameSync(tmpPath, filePath);
}

function listSources(sourcesRoot) {
	if (!fs.existsSync(sourcesRoot)) {
		return { path: sourcesRoot, sources: [] };
	}
	const sources = fs
		.readdirSync(sourcesRoot, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => {
			const folderPath = path.join(sourcesRoot, entry.name);
			const files = fs
				.readdirSync(folderPath, { withFileTypes: true })
				.filter(file => file.isFile() && /\.(csv|md)$/i.test(file.name))
				.map(file => {
					const filePath = path.join(folderPath, file.name);
					return { name: file.name, bytes: fs.statSync(filePath).size };
				})
				.sort((a, b) => a.name.localeCompare(b.name));
			return {
				name: entry.name,
				filesCount: files.length,
				bytes: files.reduce((sum, file) => sum + file.bytes, 0),
				files,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	return { path: sourcesRoot, sources };
}

function createApp(config) {
	const appConfig = { ...CONFIG, ...config };
	let building = false;

	const route = async (req, res) => {
		const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
		const { pathname } = url;

		const sourceCreateMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
		const sourceFileMatch = pathname.match(/^\/api\/sources\/([^/]+)\/files\/([^/]+)$/);

		try {
			if (req.method === 'GET' && pathname === '/api/status') {
				return await handleStatus(res);
			}
			if (req.method === 'GET' && pathname === '/api/datasets') {
				return await handleDatasetList(res);
			}
			if (req.method === 'GET' && pathname === '/api/dataset') {
				return await handleGetDataset(res, url);
			}
			if (req.method === 'PUT' && pathname === '/api/dataset') {
				return await handlePutDataset(req, res, url);
			}
			if (req.method === 'GET' && pathname === '/api/sources') {
				return sendJson(res, 200, listSources(appConfig.sourcesRoot));
			}
			if (req.method === 'POST' && sourceCreateMatch) {
				return await handleCreateSourceFolder(res, decodeURIComponent(sourceCreateMatch[1]));
			}
			if (req.method === 'PUT' && sourceFileMatch) {
				return await handlePutSourceFile(req, res, decodeURIComponent(sourceFileMatch[1]), decodeURIComponent(sourceFileMatch[2]));
			}
			if (req.method === 'DELETE' && sourceFileMatch) {
				return await handleDeleteSourceFile(res, decodeURIComponent(sourceFileMatch[1]), decodeURIComponent(sourceFileMatch[2]));
			}
			if (req.method === 'GET' && pathname === '/api/source-metadata') {
				return await handleGetSourceMetadata(res);
			}
			if (req.method === 'PUT' && pathname === '/api/source-metadata') {
				return await handlePutSourceMetadata(req, res);
			}
			if (req.method === 'GET' && pathname === '/api/config/keyword-filter') {
				return await handleGetKeywordFilter(res);
			}
			if (req.method === 'PUT' && pathname === '/api/config/keyword-filter') {
				return await handlePutKeywordFilter(req, res);
			}
			if (req.method === 'POST' && pathname === '/api/build') {
				return await handleBuild(req, res);
			}
			if (req.method === 'GET' && pathname === '/api/health') {
				return sendJson(res, 200, { ok: true, pid: process.pid });
			}
			if (req.method === 'GET') {
				return await serveStatic(res, url);
			}
			return sendText(res, 405, 'Method not allowed');
		} catch (error) {
			return sendJson(res, error.status || 400, {
				error: error.message,
				...(error.validationErrors ? { validationErrors: error.validationErrors } : {}),
			});
		}
	};

	function handleStatus(res) {
		const databases = listDatabaseFiles(appConfig.nyaDbRoot);
		const categories = readDatabase(appConfig.nyaDbRoot, 'categories');
		return sendJson(res, 200, {
			lock: { held: true, pid: process.pid, path: appConfig.lockPath },
			building,
			databases,
			categories: toArray(categories, 'categories'),
			sourcesRoot: appConfig.sourcesRoot,
			nyaDbRoot: appConfig.nyaDbRoot,
		});
	}

	function handleDatasetList(res) {
		const databases = listDatabaseFiles(appConfig.nyaDbRoot);
		return sendJson(res, 200, { databases });
	}

	function handleGetDataset(res, url) {
		const name = safeDatabaseName(url.searchParams.get('name'));
		const contents = readDatabase(appConfig.nyaDbRoot, name);
		if (contents === null) return sendJson(res, 404, { error: `Database not found: ${name}` });
		return sendJson(res, 200, { name, contents });
	}

	async function handlePutDataset(req, res, url) {
		const name = safeDatabaseName(url.searchParams.get('name'));
		const body = await readJsonBody(req, appConfig.maxBodyBytes);
		if (!isPlainObject(body)) {
			throw Object.assign(new Error('Dataset payload must be a JSON object'), { status: 400 });
		}
		writeDatabase(appConfig.nyaDbRoot, name, body);
		return sendJson(res, 200, { ok: true, name });
	}

	async function handleBuild(req, res) {
		if (building) {
			return sendJson(res, 409, { error: 'A build is already running.' });
		}
		const body = await readJsonBody(req, appConfig.maxBodyBytes);
		const writeNyaDb = body.writeNyaDb === true;
		building = true;
		res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
		const logger = createLogger(entry => {
			try {
				res.write(JSON.stringify({ type: 'log', level: entry.level, message: entry.message }) + '\n');
			} catch {
				// Response may already be closed; ignore.
			}
		});
		const finish = payload => {
			try {
				res.end(JSON.stringify({ type: 'result', result: { ...payload, logs: logger.entries, writeNyaDb } }) + '\n');
			} catch {
				// Response stream already closed.
			}
		};
		try {
			let result;
			try {
				result = await (appConfig.buildDatabaseFn || buildDatabase)({
					sheetsRoot: appConfig.sourcesRoot,
					registryPath: appConfig.registryPath,
					sourceMetadataConfigPath: appConfig.sourceMetadataConfigPath,
					sourceGroups: appConfig.sourceGroups,
					writeNyaDb,
					logger,
				});
			} catch (error) {
				throw error;
			}
			const updatedCount = result.writtenDatabases.changed.length + result.writtenDatabases.deleted.length;
			return finish({
				success: true,
				report: result.report,
				writtenDatabases: result.writtenDatabases,
				updatedCount,
			});
		} catch (error) {
			const diagnostics = buildFailureReport({
				error,
				logs: logger.entries,
				mode: 'web',
				writeNyaDb,
				context: { sourcesRoot: appConfig.sourcesRoot, sourceMetadataConfigPath: appConfig.sourceMetadataConfigPath },
			});
			if (error.validationErrors) {
				return finish({
					success: false,
					validationErrors: error.validationErrors,
					report: error.report,
					diagnostics,
				});
			}
			logger.error(error);
			return finish({ success: false, error: error.message, diagnostics });
		} finally {
			building = false;
		}
	}

	function handleGetSourceMetadata(res) {
		const filePath = appConfig.sourceMetadataConfigPath;
		if (!fs.existsSync(filePath)) {
			return sendJson(res, 200, { path: filePath, exists: false, contents: {} });
		}
		const contents = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		return sendJson(res, 200, { path: filePath, exists: true, contents });
	}

	async function handlePutSourceMetadata(req, res) {
		const body = await readJsonBody(req, appConfig.maxBodyBytes);
		if (!isPlainObject(body)) {
			throw Object.assign(new Error('Source metadata must be a JSON object'), { status: 400 });
		}
		const filePath = appConfig.sourceMetadataConfigPath;
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const tmpPath = `${filePath}.tmp-${process.pid}`;
		fs.writeFileSync(tmpPath, JSON.stringify(body, null, 2), 'utf8');
		fs.renameSync(tmpPath, filePath);
		return sendJson(res, 200, { ok: true, path: filePath });
	}

	function handleCreateSourceFolder(res, folder) {
		const name = safeSourceFolder(folder);
		const folderPath = path.join(appConfig.sourcesRoot, name);
		if (!fs.existsSync(path.dirname(folderPath))) {
			fs.mkdirSync(path.dirname(folderPath), { recursive: true });
		}
		fs.mkdirSync(folderPath, { recursive: true });
		return sendJson(res, 200, { ok: true, name });
	}

	async function handlePutSourceFile(req, res, folder, file) {
		const folderName = safeSourceFolder(folder);
		const fileName = safeSourceFileName(file);
		const buffer = await readRawBody(req, appConfig.maxBodyBytes);
		const text = buffer.toString('utf8');
		if (!text.length) {
			throw Object.assign(new Error('File content is empty'), { status: 400 });
		}
		const folderPath = path.join(appConfig.sourcesRoot, folderName);
		fs.mkdirSync(folderPath, { recursive: true });
		const filePath = path.join(folderPath, fileName);
		const tmpPath = `${filePath}.tmp-${process.pid}`;
		fs.writeFileSync(tmpPath, text, 'utf8');
		fs.renameSync(tmpPath, filePath);
		return sendJson(res, 200, { ok: true, folder: folderName, name: fileName, bytes: Buffer.byteLength(text) });
	}

	function handleDeleteSourceFile(res, folder, file) {
		const folderName = safeSourceFolder(folder);
		const fileName = safeSourceFileName(file);
		const filePath = path.join(appConfig.sourcesRoot, folderName, fileName);
		if (!fs.existsSync(filePath)) {
			return sendJson(res, 404, { error: `File not found: ${fileName}` });
		}
		fs.unlinkSync(filePath);
		return sendJson(res, 200, { ok: true, folder: folderName, name: fileName });
	}

	function handleGetKeywordFilter(res) {
		const filePath = appConfig.keywordFilterPath;
		if (!fs.existsSync(filePath)) {
			return sendJson(res, 200, { path: filePath, exists: false, contents: { keywords: [] } });
		}
		const contents = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		return sendJson(res, 200, { path: filePath, exists: true, contents });
	}

	async function handlePutKeywordFilter(req, res) {
		const body = await readJsonBody(req, appConfig.maxBodyBytes);
		if (!isPlainObject(body) || !Array.isArray(body.keywords)) {
			throw Object.assign(new Error('Keyword filter must be a JSON object with a "keywords" array'), { status: 400 });
		}
		const keywords = body.keywords.map(keyword => String(keyword).trim()).filter(Boolean);
		const filePath = appConfig.keywordFilterPath;
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const tmpPath = `${filePath}.tmp-${process.pid}`;
		fs.writeFileSync(tmpPath, JSON.stringify({ keywords }, null, 2), 'utf8');
		fs.renameSync(tmpPath, filePath);
		return sendJson(res, 200, { ok: true, path: filePath, count: keywords.length });
	}

	function serveStatic(res, url) {
		const requested = url.pathname === '/' ? '/index.html' : url.pathname;
		const filePath = path.resolve(appConfig.publicRoot, `.${requested}`);
		if (!filePath.startsWith(appConfig.publicRoot + path.sep)) {
			return sendText(res, 403, 'Forbidden');
		}
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			return sendText(res, 404, 'Not found');
		}
		const ext = path.extname(filePath);
		res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
		fs.createReadStream(filePath).pipe(res);
	}

	const server = http.createServer((req, res) => {
		route(req, res).catch(error => {
			sendJson(res, 500, { error: error.message });
		});
	});

	return { server, config: appConfig };
}

function main() {
	const acquired = lockApi.acquire(CONFIG.lockPath);
	if (!acquired.ok) {
		console.error('\nAnother build is already running (the CLI or another web instance).');
		console.error('Close it or wait until it finishes, then start the web panel again.');
		process.exit(3);
	}

	const { server, config } = createApp();
	let closing = false;
	const shutdown = () => {
		if (closing) return;
		closing = true;
		server.close(() => {
			lockApi.release(config.lockPath);
			process.exit(0);
		});
		setTimeout(() => {
			lockApi.release(config.lockPath);
			process.exit(0);
		}, 5000).unref();
	};

	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.once(signal, shutdown);
	}
	process.on('exit', () => lockApi.release(config.lockPath));

	fs.mkdirSync(config.nyaDbRoot, { recursive: true });
	server.listen(config.port, config.host, () => {
		console.log(`Web panel running at http://${config.host}:${config.port}`);
		console.log(`Lock held: ${config.lockPath}`);
		console.log(`Press Ctrl+C to close the panel and release the lock.`);
	});
}

if (require.main === module) {
	main();
}

module.exports = { createApp, CONFIG, lockApi };
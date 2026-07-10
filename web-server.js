const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const { buildDatabase } = require('./index');

const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, 'public');
const JOB_ROOT = path.join(ROOT, 'tmp', 'web-jobs');
const MAIN_REGISTRY = path.join(ROOT, 'perk-id-registry.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 250 * 1024 * 1024);

const jobs = new Map();

const MIME_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
};

function sendJson(res, statusCode, payload) {
	const body = JSON.stringify(payload, null, 2);
	res.writeHead(statusCode, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(body),
	});
	res.end(body);
}

function sendText(res, statusCode, message) {
	res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
	res.end(message);
}

function safeSegment(value, fallback = 'upload') {
	const cleaned = String(value || fallback)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9._ -]+/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
	return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
}

function safeRelativePath(value) {
	return String(value || '')
		.replace(/\\/g, '/')
		.split('/')
		.map(part => safeSegment(part))
		.filter(part => part && part !== '.' && part !== '..')
		.join('/');
}

function parseHeaderParams(headerValue) {
	const params = {};
	for (const part of headerValue.split(';')) {
		const [rawKey, ...rawValue] = part.trim().split('=');
		if (!rawValue.length) continue;
		const value = rawValue.join('=').trim();
		params[rawKey.toLowerCase()] = value.replace(/^"|"$/g, '');
	}
	return params;
}

function splitMultipart(buffer, boundary) {
	const boundaryBuffer = Buffer.from(`--${boundary}`);
	const parts = [];
	let cursor = buffer.indexOf(boundaryBuffer);

	while (cursor !== -1) {
		cursor += boundaryBuffer.length;
		if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
		if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;
		const next = buffer.indexOf(boundaryBuffer, cursor);
		if (next === -1) break;
		let end = next;
		if (buffer[end - 2] === 13 && buffer[end - 1] === 10) end -= 2;
		parts.push(buffer.subarray(cursor, end));
		cursor = next;
	}

	return parts;
}

async function readRequestBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > MAX_UPLOAD_BYTES) throw new Error(`Upload exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

async function parseMultipartRequest(req) {
	const contentType = req.headers['content-type'] || '';
	const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
	if (!boundary) throw new Error('Missing multipart boundary');

	const buffer = await readRequestBody(req);
	const fields = {};
	const files = [];

	for (const part of splitMultipart(buffer, boundary)) {
		const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
		if (headerEnd === -1) continue;
		const rawHeaders = part.subarray(0, headerEnd).toString('utf8');
		const body = part.subarray(headerEnd + 4);
		const headers = Object.fromEntries(
			rawHeaders.split('\r\n').map(line => {
				const index = line.indexOf(':');
				return index === -1 ? [line.toLowerCase(), ''] : [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()];
			}),
		);
		const disposition = headers['content-disposition'];
		if (!disposition) continue;
		const params = parseHeaderParams(disposition);
		if (!params.name) continue;

		if (params.filename !== undefined) {
			if (!params.filename || !body.length) continue;
			files.push({
				field: params.name,
				filename: params.filename,
				buffer: body,
			});
		} else {
			fields[params.name] = body.toString('utf8');
		}
	}

	return { fields, files };
}

function createLogger() {
	const entries = [];
	const push = (level, values) => {
		entries.push({
			level,
			message: values
				.map(value => {
					if (value instanceof Error) return value.stack || value.message;
					if (typeof value === 'string') return value;
					return JSON.stringify(value);
				})
				.join(' '),
		});
	};
	return {
		entries,
		log: (...values) => push('info', values),
		warn: (...values) => push('warn', values),
		error: (...values) => push('error', values),
	};
}

async function writeUploadedFiles(files, fields, sheetsRoot) {
	const category = safeSegment(fields.category || 'uploaded');
	const saved = [];

	for (const file of files) {
		const relative = safeRelativePath(file.filename);
		if (!relative) continue;
		const ext = path.extname(relative).toLowerCase();
		if (ext !== '.csv' && ext !== '.md') continue;

		const parts = relative.split('/');
		const targetRelative = parts.length > 1 ? relative : path.join(category, parts[0]);
		const targetPath = path.join(sheetsRoot, targetRelative);
		const resolved = path.resolve(targetPath);
		if (!resolved.startsWith(path.resolve(sheetsRoot) + path.sep)) throw new Error(`Unsafe upload path: ${file.filename}`);
		await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
		await fs.promises.writeFile(resolved, file.buffer);
		saved.push(targetRelative);
	}

	return saved.sort((a, b) => a.localeCompare(b));
}

function listOutputFiles(outRoot) {
	if (!fs.existsSync(outRoot)) return [];
	return fs
		.readdirSync(outRoot, { withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
		.map(entry => {
			const filePath = path.join(outRoot, entry.name);
			return {
				name: entry.name,
				bytes: fs.statSync(filePath).size,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

async function handleConvert(req, res) {
	const jobId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
	const jobRoot = path.join(JOB_ROOT, jobId);
	const sheetsRoot = path.join(jobRoot, 'sheets');
	const outRoot = path.join(jobRoot, 'data');
	const tempRegistry = path.join(jobRoot, 'perk-id-registry.json');
	const logger = createLogger();

	try {
		await fs.promises.mkdir(sheetsRoot, { recursive: true });
		const { fields, files } = await parseMultipartRequest(req);
		const uploadedFiles = await writeUploadedFiles(files, fields, sheetsRoot);
		if (!uploadedFiles.length) throw new Error('Upload at least one CSV or Markdown file.');

		const persistRegistry = fields.persistRegistry === 'true';
		if (!persistRegistry && fs.existsSync(MAIN_REGISTRY)) {
			await fs.promises.copyFile(MAIN_REGISTRY, tempRegistry);
		}

		const result = await buildDatabase({
			sheetsRoot,
			outRoot,
			registryPath: persistRegistry ? MAIN_REGISTRY : tempRegistry,
			retireMissing: false,
			writeNyaDb: fields.writeNyaDb !== 'false',
			logger,
		});

		const outputFiles = listOutputFiles(outRoot);
		const job = {
			id: jobId,
			createdAt: new Date().toISOString(),
			jobRoot,
			outRoot,
			uploadedFiles,
			outputFiles,
			report: result.report,
			logs: logger.entries,
		};
		jobs.set(jobId, job);

		sendJson(res, 200, job);
	} catch (error) {
		jobs.set(jobId, {
			id: jobId,
			createdAt: new Date().toISOString(),
			jobRoot,
			outRoot,
			report: null,
			logs: logger.entries,
			error: error.message,
		});
		sendJson(res, 400, {
			id: jobId,
			error: error.message,
			logs: logger.entries,
		});
	}
}

function handleDownload(req, res, url) {
	const jobId = url.searchParams.get('job');
	const fileName = url.searchParams.get('file');
	const job = jobs.get(jobId);
	if (!job || !fileName) return sendText(res, 404, 'File not found');
	const safeName = path.basename(fileName);
	const filePath = path.resolve(job.outRoot, safeName);
	if (!filePath.startsWith(path.resolve(job.outRoot) + path.sep) || !fs.existsSync(filePath)) return sendText(res, 404, 'File not found');

	res.writeHead(200, {
		'content-type': 'application/json; charset=utf-8',
		'content-disposition': `attachment; filename="${safeName}"`,
	});
	fs.createReadStream(filePath).pipe(res);
}

function handleStatus(_req, res) {
	let nyaDb = null;
	try {
		const NyaDB = require('@decaded/nyadb');
		const db = new NyaDB({ writeDebounce: 0, maxFileSize: 1024 });
		nyaDb = {
			databases: db.getList().sort((a, b) => a.localeCompare(b)),
			size: db.size(),
		};
	} catch (error) {
		nyaDb = { error: error.message };
	}

	sendJson(res, 200, {
		jobs: [...jobs.values()].map(job => ({
			id: job.id,
			createdAt: job.createdAt,
			report: job.report,
			error: job.error,
		})),
		nyaDb,
	});
}

function serveStatic(req, res, url) {
	const requested = url.pathname === '/' ? '/index.html' : url.pathname;
	const filePath = path.resolve(PUBLIC_ROOT, `.${requested}`);
	if (!filePath.startsWith(PUBLIC_ROOT + path.sep)) return sendText(res, 403, 'Forbidden');
	if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendText(res, 404, 'Not found');

	const ext = path.extname(filePath);
	res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
	fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
	if (req.method === 'POST' && url.pathname === '/api/convert') return handleConvert(req, res);
	if (req.method === 'GET' && url.pathname === '/api/download') return handleDownload(req, res, url);
	if (req.method === 'GET' && url.pathname === '/api/status') return handleStatus(req, res);
	if (req.method === 'GET') return serveStatic(req, res, url);
	return sendText(res, 405, 'Method not allowed');
});

fs.mkdirSync(JOB_ROOT, { recursive: true });
server.listen(PORT, HOST, () => {
	console.log(`CSV Chaos Tamer web interface running at http://${HOST}:${PORT}`);
	console.log(`NyaDB output folder: ${path.join(ROOT, 'NyaDB')}`);
	console.log(`Upload staging folder: ${path.relative(ROOT, JOB_ROOT)}`);
});

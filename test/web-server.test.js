const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { testAsync } = require('./summary');
const { createApp } = require('../web-server');

function request(server, { method = 'GET', path: pathname, body, raw }) {
	return new Promise((resolve, reject) => {
		const address = server.address();
		const payload = raw !== undefined ? String(raw) : body === undefined ? null : JSON.stringify(body);
		const headers = payload !== null && raw !== true ? { 'content-type': 'application/json' } : {};
		const req = http.request({ host: address.address, port: address.port, method, path: pathname, headers }, res => {
			const chunks = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				if ((res.headers['content-type'] || '').includes('x-ndjson')) {
					const lines = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
					const finalLine = lines[lines.length - 1];
					resolve({ status: res.statusCode, json: finalLine?.type === 'result' ? finalLine.result : finalLine, stream: lines });
					return;
				}
				let json;
				try {
					json = JSON.parse(text);
				} catch {
					json = text;
				}
				resolve({ status: res.statusCode, json });
			});
		});
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}

async function setup() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-chaos-web-'));
	process.chdir(dir);
	const sourcesRoot = path.join(dir, 'sources');
	const nyaDbRoot = path.join(dir, 'NyaDB');
	const configPath = path.join(dir, 'source-metadata.config.json');
	const registryPath = path.join(dir, 'perk-id-registry.json');

	fs.mkdirSync(path.join(sourcesRoot, 'forge'), { recursive: true });
	fs.writeFileSync(path.join(sourcesRoot, 'forge', 'Forge.csv'), ['Name,Cost,Source,Description', 'Hammer Time,200,The Forge,Make tools.', 'Anvil Time,300,The Forge,Make heavier tools.'].join('\n'), 'utf8');
	fs.writeFileSync(configPath, JSON.stringify({ forge: { description: 'Crafting perks.', defaultVersion: 'default', editions: { default: { fileKey: 'forge', sourceUrl: 'https://example.com' } } } }), 'utf8');

	const app = createApp({ sourcesRoot, nyaDbRoot, sourceMetadataConfigPath: configPath, keywordFilterPath: path.join(dir, 'keyword-filter.json'), datasetConfigPath: path.join(dir, 'dataset.json'), registryPath });
	await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
	return { server: app.server, dir };
}

function close(server) {
	return new Promise(resolve => {
		server.closeAllConnections?.();
		server.close(resolve);
	});
}

let chain = Promise.resolve();
function enqueue(name, fn) {
	const next = chain.then(fn);
	chain = next.catch(() => {});
	testAsync(name, async () => {
		await next;
	});
}

const shared = setup();

enqueue('web server serves health, status, sources, and source metadata', async () => {
	const { server } = await shared;

	const health = await request(server, { path: '/api/health' });
	assert.strictEqual(health.status, 200);
	assert.strictEqual(health.json.ok, true);

	const status = await request(server, { path: '/api/status' });
	assert.strictEqual(status.status, 200);
	assert.deepStrictEqual(status.json.databases, []);
	assert.strictEqual(status.json.lock.pid, process.pid);

	const sources = await request(server, { path: '/api/sources' });
	assert.strictEqual(sources.status, 200);
	assert.strictEqual(sources.json.sources.length, 1);
	assert.strictEqual(sources.json.sources[0].name, 'forge');
	assert.strictEqual(sources.json.sources[0].files[0].name, 'Forge.csv');

	const metadata = await request(server, { path: '/api/source-metadata' });
	assert.strictEqual(metadata.status, 200);
	assert.strictEqual(metadata.json.contents.forge.editions.default.sourceUrl, 'https://example.com');
});

enqueue('dry-run build validates and writes no NyaDB files', async () => {
	const { server, dir } = await shared;
	const result = await request(server, { method: 'POST', path: '/api/build', body: { writeNyaDb: false } });
	assert.strictEqual(result.status, 200);
	assert.strictEqual(result.json.success, true);
	assert.strictEqual(result.json.writeNyaDb, false);
	assert.strictEqual(result.json.report.perkCount, 2);
	assert.strictEqual(result.json.updatedCount, 0);
	assert.ok(result.stream.some(line => line.type === 'log' && line.level === 'info' && line.message), 'build streams structured log lines');
	const nyaDbPath = path.join(dir, 'NyaDB');
	const files = fs.existsSync(nyaDbPath) ? fs.readdirSync(nyaDbPath).length : 0;
	assert.strictEqual(files, 0);
});

enqueue('write build stores databases and a second identical build reports no changes', async () => {
	const { server } = await shared;
	const first = await request(server, { method: 'POST', path: '/api/build', body: { writeNyaDb: true } });
	assert.strictEqual(first.json.success, true);
	const names = first.json.writtenDatabases.changed;
	assert.ok(names.includes('perks_forge'));
	assert.ok(names.includes('generatorSources'));

	const second = await request(server, { method: 'POST', path: '/api/build', body: { writeNyaDb: true } });
	assert.strictEqual(second.json.success, true);
	assert.strictEqual(second.json.updatedCount, 0);
	assert.strictEqual(second.json.writtenDatabases.changed.length, 0);
});

enqueue('dataset list, get, and put round-trip through the API', async () => {
	const { server } = await shared;
	await request(server, { method: 'POST', path: '/api/build', body: { writeNyaDb: true } });

	const list = await request(server, { path: '/api/datasets' });
	assert.ok(list.json.databases.some(db => db.name === 'perks_forge'));

	const get = await request(server, { path: '/api/dataset?name=perks_forge' });
	assert.strictEqual(get.status, 200);
	assert.ok(get.json.contents);

	const put = await request(server, { method: 'PUT', path: '/api/dataset?name=custom', body: { hello: 'world' } });
	assert.strictEqual(put.status, 200);
	const after = await request(server, { path: '/api/dataset?name=custom' });
	assert.deepStrictEqual(after.json.contents, { hello: 'world' });

	const missing = await request(server, { path: '/api/dataset?name=nope' });
	assert.strictEqual(missing.status, 404);

	const invalid = await request(server, { method: 'PUT', path: '/api/dataset?name=Bad%20Name', body: {} });
	assert.strictEqual(invalid.status, 400);
});

enqueue('source metadata can be saved and reloaded', async () => {
	const { server } = await shared;
	const updated = await request(server, {
		method: 'PUT',
		path: '/api/source-metadata',
		body: {
			forge: {
				description: 'Updated description.',
				defaultVersion: 'default',
				editions: {
					default: { fileKey: 'forge', sourceUrl: 'https://example.com', altSourceUrl: 'https://alt.example.com', altSourceLabel: 'Alt' },
				},
			},
		},
	});
	assert.strictEqual(updated.status, 200);

	const loaded = await request(server, { path: '/api/source-metadata' });
	assert.strictEqual(loaded.json.contents.forge.description, 'Updated description.');
	assert.strictEqual(loaded.json.contents.forge.editions.default.altSourceLabel, 'Alt');
});

enqueue('source metadata editions round-trip through the API', async () => {
	const { server } = await shared;
	const editionsConfig = {
		forge: {
			description: 'Crafting perks.',
			sourceUrl: 'https://example.com',
			defaultVersion: 'default',
			editions: {
				default: { fileKey: 'forge', sourceUrl: 'https://example.com' },
				v2: { fileKey: 'forge_v2', sourceUrl: 'https://v2.example.com' },
			},
		},
	};
	const updated = await request(server, { method: 'PUT', path: '/api/source-metadata', body: editionsConfig });
	assert.strictEqual(updated.status, 200);

	const loaded = await request(server, { path: '/api/source-metadata' });
	assert.deepStrictEqual(loaded.json.contents, editionsConfig);
	assert.strictEqual(loaded.json.contents.forge.editions.v2.fileKey, 'forge_v2');
});

enqueue('unknown API paths 404 and wrong methods 405', async () => {
	const { server } = await shared;
	const notFound = await request(server, { path: '/api/does-not-exist' });
	assert.strictEqual(notFound.status, 404);

	const wrongMethod = await request(server, { method: 'DELETE', path: '/api/dataset' });
	assert.strictEqual(wrongMethod.status, 405);

	const staticIndex = await request(server, { path: '/' });
	assert.strictEqual(staticIndex.status, 200);
	assert.match(staticIndex.json, /<!doctype html>/i);
});

enqueue('source folders support create, file upload/delete, and validate names', async () => {
	const { server, dir } = await shared;

	const created = await request(server, { method: 'POST', path: '/api/sources/mystery_source', body: {} });
	assert.strictEqual(created.status, 200);

	const content = 'Name,Cost,Source,Description\nMystery,50,Unknown,Work it.\n';
	const uploaded = await request(server, { method: 'PUT', path: '/api/sources/mystery_source/files/Mystery%20Chapter.csv', raw: content });
	assert.strictEqual(uploaded.status, 200);
	assert.strictEqual(uploaded.json.bytes, Buffer.byteLength(content));

	const onDisk = fs.readFileSync(path.join(dir, 'sources', 'mystery_source', 'Mystery Chapter.csv'), 'utf8');
	assert.strictEqual(onDisk, content);

	const md = await request(server, { method: 'PUT', path: '/api/sources/mystery_source/files/notes.md', raw: '# Notes\n' });
	assert.strictEqual(md.status, 200);

	const listing = await request(server, { path: '/api/sources' });
	const source = listing.json.sources.find(s => s.name === 'mystery_source');
	assert.ok(source, 'created source appears in the listing');
	assert.strictEqual(source.filesCount, 2);

	const removed = await request(server, { method: 'DELETE', path: '/api/sources/mystery_source/files/notes.md' });
	assert.strictEqual(removed.status, 200);
	assert.strictEqual(fs.existsSync(path.join(dir, 'sources', 'mystery_source', 'notes.md')), false);

	const removeAgain = await request(server, { method: 'DELETE', path: '/api/sources/mystery_source/files/notes.md' });
	assert.strictEqual(removeAgain.status, 404);

	const badExtension = await request(server, { method: 'PUT', path: '/api/sources/mystery_source/files/evil.txt', raw: 'x' });
	assert.strictEqual(badExtension.status, 400);

	const badFolder = await request(server, { method: 'POST', path: '/api/sources/..%2Fsneaky', body: {} });
	assert.strictEqual(badFolder.status, 400);

	const emptyFile = await request(server, { method: 'PUT', path: '/api/sources/mystery_source/files/Empty.csv', raw: '' });
	assert.strictEqual(emptyFile.status, 400);
});

enqueue('keyword filter config round-trips and rejects bad shapes', async () => {
	const { server, dir } = await shared;
	const pathLabel = path.join(dir, 'keyword-filter.json');

	const initial = await request(server, { path: '/api/config/keyword-filter' });
	assert.strictEqual(initial.status, 200);
	assert.strictEqual(initial.json.path, pathLabel);

	const saved = await request(server, { method: 'PUT', path: '/api/config/keyword-filter', body: { keywords: [' alpha ', 'lewd', ''] } });
	assert.strictEqual(saved.status, 200);
	assert.strictEqual(saved.json.count, 2);

	const after = await request(server, { path: '/api/config/keyword-filter' });
	assert.deepStrictEqual(after.json.contents, { keywords: ['alpha', 'lewd'] });
	assert.strictEqual(JSON.parse(fs.readFileSync(pathLabel, 'utf8')).keywords.length, 2);

	const badShape = await request(server, { method: 'PUT', path: '/api/config/keyword-filter', body: { keywords: 'nope' } });
	assert.strictEqual(badShape.status, 400);
});

enqueue('dataset config round-trips and rejects bad shapes', async () => {
	const { server, dir } = await shared;
	const pathLabel = path.join(dir, 'dataset.json');

	const initial = await request(server, { path: '/api/config/dataset' });
	assert.strictEqual(initial.status, 200);
	assert.strictEqual(initial.json.path, pathLabel);
	assert.strictEqual(initial.json.contents.name, 'Celestial Gambler Dataset');
	assert.strictEqual(initial.json.contents.datasetVersion, 'development');

	const saved = await request(server, { method: 'PUT', path: '/api/config/dataset', body: { datasetVersion: '1.2.3' } });
	assert.strictEqual(saved.status, 200);
	assert.strictEqual(saved.json.contents.datasetVersion, '1.2.3');
	assert.strictEqual(saved.json.contents.name, 'Celestial Gambler Dataset');

	const after = await request(server, { path: '/api/config/dataset' });
	assert.deepStrictEqual(after.json.contents, { name: 'Celestial Gambler Dataset', datasetVersion: '1.2.3', description: 'Public Celestial Gambler perk dataset.' });
	assert.strictEqual(JSON.parse(fs.readFileSync(pathLabel, 'utf8')).datasetVersion, '1.2.3');

	const badShape = await request(server, { method: 'PUT', path: '/api/config/dataset', body: { datasetVersion: 42 } });
	assert.strictEqual(badShape.status, 400);

	const empty = await request(server, { method: 'PUT', path: '/api/config/dataset', body: { datasetVersion: '' } });
	assert.strictEqual(empty.status, 400);
});

enqueue('builds are refused while another build is running', async () => {
	const { dir } = await shared;
	let release;
	const gate = new Promise(resolve => (release = resolve));
	const slowBuild = async () => {
		await gate;
		return { report: { perkCount: 7 }, databases: ['perks_forge'], writtenDatabases: { changed: ['perks_forge'], unchanged: [], deleted: [] } };
	};

	const app = createApp({
		sourcesRoot: path.join(dir, 'sources'),
		nyaDbRoot: path.join(dir, 'NyaDB'),
		sourceMetadataConfigPath: path.join(dir, 'source-metadata.config.json'),
		keywordFilterPath: path.join(dir, 'keyword-filter.json'),
		registryPath: path.join(dir, 'perk-id-registry.json'),
		buildDatabaseFn: slowBuild,
	});
	await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));

	const firstPromise = request(app.server, { method: 'POST', path: '/api/build', body: { writeNyaDb: false } });
	await new Promise(resolve => setTimeout(resolve, 50));

	const second = await request(app.server, { method: 'POST', path: '/api/build', body: { writeNyaDb: false } });
	assert.strictEqual(second.status, 409);
	assert.match(second.json.error, /already running/);

	release();
	const first = await firstPromise;
	assert.strictEqual(first.json.success, true);
	await close(app.server);
	await close((await shared).server);
});
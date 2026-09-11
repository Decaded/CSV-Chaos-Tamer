const $ = id => document.getElementById(id);

const serverStatus = $('serverStatus');
const refreshStatusButton = $('refreshStatus');
const tabHome = $('tabHome');
const tabBuild = $('tabBuild');
const tabSourceMetadata = $('tabSourceMetadata');
const tabKeywordFilter = $('tabKeywordFilter');
const tabDatasets = $('tabDatasets');
const paneHome = $('paneHome');
const paneBuild = $('paneBuild');
const paneSourceMetadata = $('paneSourceMetadata');
const paneKeywordFilter = $('paneKeywordFilter');
const paneDatasets = $('paneDatasets');

const buildButton = $('buildButton');
const writeNyaDbCheckbox = $('writeNyaDb');
const runState = $('runState');
const metrics = $('metrics');
const buildSummary = $('buildSummary');
const buildResultBlock = $('buildResultBlock');
const validationErrors = $('validationErrors');
const buildDiagnostics = $('buildDiagnostics');
const clearLogsButton = $('clearLogs');
const logs = $('logs');

const datasetVersionInput = $('datasetVersion');
const saveDatasetConfigButton = $('saveDatasetConfig');

const reloadSourceMetadataButton = $('reloadSourceMetadata');
const addMetaRowButton = $('addMetaRow');
const sourceModal = $('sourceModal');
const closeSourceModalButton = $('closeSourceModal');
const sourceModalName = $('sourceModalName');
const sourceModalSlug = $('sourceModalSlug');
const sourceModalUrl = $('sourceModalUrl');
const sourceModalDesc = $('sourceModalDesc');
const sourceModalUploadSection = $('sourceModalUploadSection');
const sourceModalUpload = $('sourceModalUpload');
const sourceModalStagedFiles = $('sourceModalStagedFiles');
const saveSourceModalButton = $('saveSourceModal');
const metadataTableBody = $('metaTableBody');
const metadataSearch = $('metadataSearch');
const metadataSearchCount = $('metadataSearchCount');

const reloadKeywordFilterButton = $('reloadKeywordFilter');
const keywordFilterEditor = $('keywordFilterEditor');
const keywordSearch = $('keywordSearch');
const keywordSearchPrev = $('keywordSearchPrev');
const keywordSearchNext = $('keywordSearchNext');
const keywordSearchCount = $('keywordSearchCount');
const keywordJump = $('keywordJump');
const keywordHighlights = $('keywordHighlights');

const refreshDatasetsButton = $('refreshDatasets');
const datasetSummary = $('datasetSummary');
const datasetList = $('datasetList');
const selectedDataset = $('selectedDataset');
const clearDatasetSelectionButton = $('clearDatasetSelection');
const datasetEditor = $('datasetEditor');
const reloadDatasetButton = $('reloadDataset');
const editorSearch = $('editorSearch');
const editorSearchPrev = $('editorSearchPrev');
const editorSearchNext = $('editorSearchNext');
const editorSearchCount = $('editorSearchCount');
const editorJump = $('editorJump');
const editorHighlights = $('editorHighlights');

const appModal = $('appModal');
const appModalTitle = $('appModalTitle');
const appModalMessage = $('appModalMessage');
const appModalConfirm = $('appModalConfirm');
const appModalCancel = $('appModalCancel');
const appModalClose = $('appModalClose');
const toastRack = $('toastRack');

const RESERVED_DATABASES = new Set(['dataset', 'categories', 'sources', 'database_backup', 'generatorSources']);

let availableDatasets = [];
let activeDatasetName = '';
let metadataRows = [];
let editionRows = [];
let modalResolver = null;
let modalKeyHandler = null;
let modalLastFocused = null;
let searchDebounceTimer = null;
let consoleLines = [];

function prettyDatasetName(name) {
	return String(name || '').replace(/^perks_/, '');
}

function setBusy(button, busy) {
	if (!button) return;
	if (busy) {
		button.disabled = true;
		button.classList.add('is-busy');
	} else {
		button.disabled = false;
		button.classList.remove('is-busy');
	}
}

async function withBusy(button, work, busyLabel) {
	if (busyLabel && button.dataset.originalLabel === undefined) button.dataset.originalLabel = button.textContent;
	if (busyLabel) button.textContent = busyLabel;
	setBusy(button, true);
	try {
		return await work();
	} finally {
		setBusy(button, false);
		if (busyLabel) {
			button.textContent = button.dataset.originalLabel;
			delete button.dataset.originalLabel;
		}
	}
}

function showToast({ message = '', variant = 'info', timeout = 3200 } = {}) {
	if (!message) return;
	const toast = document.createElement('div');
	toast.className = `toast toast-${variant}`;
	const text = document.createElement('p');
	text.textContent = message;
	const closeButton = document.createElement('button');
	closeButton.type = 'button';
	closeButton.setAttribute('aria-label', 'Dismiss notification');
	closeButton.textContent = 'X';
	const remove = () => toast.parentNode && toast.parentNode.removeChild(toast);
	closeButton.addEventListener('click', remove);
	toast.append(text, closeButton);
	toastRack.appendChild(toast);
	window.setTimeout(remove, timeout);
}

function closeModal(result) {
	if (!modalResolver) return;
	const resolve = modalResolver;
	modalResolver = null;
	appModal.hidden = true;
	appModal.setAttribute('aria-hidden', 'true');
	appModalConfirm.onclick = null;
	appModalCancel.onclick = null;
	appModalClose.onclick = null;
	appModal.onclick = null;
	if (modalKeyHandler) {
		document.removeEventListener('keydown', modalKeyHandler);
		modalKeyHandler = null;
	}
	modalLastFocused?.focus?.();
	resolve(result);
}

function showModal(options = {}) {
	if (modalResolver) closeModal(false);
	const { title = 'Notice', message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', variant = 'info', allowDismiss = true, showCancel = false } = options;

	modalLastFocused = document.activeElement;
	appModalTitle.textContent = title;
	appModalMessage.textContent = message;
	appModalConfirm.textContent = confirmLabel;
	appModalCancel.textContent = cancelLabel;
	appModalCancel.hidden = !showCancel;
	appModalClose.hidden = !allowDismiss;
	appModalConfirm.classList.toggle('danger-button', variant === 'danger');

	appModal.hidden = false;
	appModal.setAttribute('aria-hidden', 'false');
	appModalConfirm.focus();

	return new Promise(resolve => {
		modalResolver = resolve;
		appModalConfirm.onclick = () => closeModal(true);
		if (showCancel) appModalCancel.onclick = () => closeModal(false);
		if (allowDismiss) appModalClose.onclick = () => closeModal(false);
		appModal.onclick = event => {
			if (allowDismiss && event.target?.dataset?.modalClose === 'backdrop') closeModal(false);
		};
		modalKeyHandler = event => {
			if (event.key === 'Escape' && allowDismiss) {
				event.preventDefault();
				closeModal(false);
			}
			if (event.key === 'Enter' && document.activeElement === appModalConfirm) {
				event.preventDefault();
				closeModal(true);
			}
		};
		document.addEventListener('keydown', modalKeyHandler);
	});
}

function switchTab(tabName) {
	const activate = (button, pane, active) => {
		button.classList.toggle('active', active);
		pane.classList.toggle('active', active);
	};
	activate(tabHome, paneHome, tabName === 'home');
	activate(tabBuild, paneBuild, tabName === 'build');
	activate(tabSourceMetadata, paneSourceMetadata, tabName === 'source-metadata');
	activate(tabKeywordFilter, paneKeywordFilter, tabName === 'keyword-filter');
	activate(tabDatasets, paneDatasets, tabName === 'datasets');
}

function formatBytes(bytes) {
	if (!Number.isFinite(bytes)) return '';
	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function api(path, options = {}) {
	const response = await fetch(path, options);
	const contentType = response.headers.get('content-type') || '';
	const payload = contentType.includes('application/json') ? await response.json() : await response.text();
	if (!response.ok) {
		const error = new Error(payload?.error || payload || `Request failed: ${response.status}`);
		error.status = response.status;
		error.payload = payload;
		throw error;
	}
	return payload;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---- Build console ----

function logLevelClass(level) {
	if (level === 'error') return 'log-error';
	if (level === 'warn') return 'log-warn';
	return 'log-info';
}

function appendLogLines(lines) {
	for (const line of lines || []) {
		if (line && typeof line === 'object' && typeof line.message === 'string') {
			consoleLines.push({ level: line.level === 'warn' || line.level === 'error' ? line.level : 'info', message: line.message });
		} else {
			consoleLines.push({ level: 'info', message: String(line) });
		}
	}
	logs.innerHTML = consoleLines.map(line => `<span class="log-line ${logLevelClass(line.level)}">${escapeHtml(line.message)}</span>`).join('');
	logs.scrollTop = logs.scrollHeight;
}

function clearConsole() {
	consoleLines = [];
	logs.textContent = 'Ready.';
}

function renderMetrics(report) {
	if (!report) {
		metrics.innerHTML = '';
		return;
	}
	const items = [
		['Perks', report.perkCount],
		['Adult', report.adultPerkCount],
		['Sources', report.sourceCount],
		['Editions', report.editionCount],
		['Chapters', report.chapterCount],
		['Duplicate IDs', report.duplicateIdCount],
		['Errors', report.validationErrorCount],
		['Databases', report.databaseCount],
	];
	metrics.innerHTML = items
		.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${Number(value || 0).toLocaleString()}</strong></div>`)
		.join('');
}

function formatBuildResult(run) {
	if (run.success) {
		if (run.writeNyaDb) {
			const changed = run.writtenDatabases?.changed || [];
			const deleted = run.writtenDatabases?.deleted || [];
			if (!changed.length && !deleted.length) return 'No changes were made to the database files.';
			const lines = [];
			if (changed.length) lines.push(`<strong>Updated (${changed.length}):</strong> ${changed.map(name => `<code>${escapeHtml(prettyDatasetName(name))}</code>`).join(', ')}`);
			if (deleted.length) lines.push(`<strong>Removed (${deleted.length}):</strong> ${deleted.map(name => `<code>${escapeHtml(prettyDatasetName(name))}</code>`).join(', ')}`);
			return `<div class="build-db-lines">${lines.map(line => `<p>${line}</p>`).join('')}</div>`;
		}
		return 'Dry run. NyaDB was not written.';
	}
	return 'Build failed validation. NyaDB was NOT updated.';
}

async function streamBuild() {
	const response = await fetch('/api/build', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ writeNyaDb: writeNyaDbCheckbox.checked }),
	});
	if (!response.ok) {
		let message = `HTTP ${response.status}`;
		try {
			const data = await response.json();
			message = data.error || message;
		} catch {
			// keep generic message
		}
		throw new Error(message);
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let result = null;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let newlineIndex;
		while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			if (!line) continue;
			try {
				const event = JSON.parse(line);
				if (event.type === 'log') appendLogLines([event]);
				else if (event.type === 'result') result = event.result;
			} catch {
				// Skip malformed frame; the result line is what matters.
			}
		}
	}
	if (!result) throw new Error('Build ended without a result.');
	return result;
}

async function runBuild() {
	buildResultBlock.hidden = false;
	runState.className = 'status-pill running';
	runState.textContent = 'Running';
	validationErrors.innerHTML = '';
	renderBuildDiagnostics(null);
	renderMetrics(null);
	buildSummary.textContent = '';
	clearConsole();
	appendLogLines([
		{ level: 'info', message: `Build started — ${writeNyaDbCheckbox.checked ? 'write mode (NyaDB will be updated)' : 'dry run (NyaDB will not be touched)'}.` },
	]);
	try {
		const payload = await streamBuild();

		if (payload.success) {
			runState.className = 'status-pill done';
			runState.textContent = 'Done';
			renderMetrics(payload.report);
			buildSummary.innerHTML = formatBuildResult(payload);
			appendLogLines([{ level: 'info', message: `Build complete: ${(payload.report?.perkCount || 0).toLocaleString()} perks.` }]);
			await Promise.all([refreshServerStatus(), loadDatasetList()]);
			showToast({ message: `Build complete: ${(payload.report?.perkCount || 0).toLocaleString()} perks.`, variant: 'success' });
		} else if (payload.validationErrors) {
			runState.className = 'status-pill failed';
			runState.textContent = 'Failed';
			renderMetrics(payload.report);
			buildSummary.textContent = `${payload.validationErrors.length} issue(s) to fix. Nothing was written.`;
			for (const entry of payload.validationErrors) {
				const item = document.createElement('li');
				item.className = 'helper-text';
				item.textContent = entry;
				validationErrors.appendChild(item);
			}
			appendLogLines([{ level: 'error', message: `Validation failed with ${payload.validationErrors.length} issue(s).` }]);
			renderBuildDiagnostics(payload.diagnostics);
			showModal({ title: 'Build Failed', message: `${payload.validationErrors.length} validation issue(s). Check the diagnostics below to fix them, or open a bug report.`, confirmLabel: 'Close' });
		} else {
			runState.className = 'status-pill failed';
			runState.textContent = 'Failed';
			buildSummary.textContent = payload.error || 'Build failed.';
			appendLogLines([{ level: 'error', message: payload.error || 'Build failed.' }]);
			renderBuildDiagnostics(payload.diagnostics);
			showModal({ title: 'Build Failed', message: `${payload.error || 'Build failed.'} Check the diagnostics below to fix it, or open a bug report.`, confirmLabel: 'Close' });
		}
	} catch (error) {
		runState.className = 'status-pill failed';
		runState.textContent = 'Failed';
		appendLogLines([{ level: 'error', message: error.message }]);
		showModal({
			title: 'Build Failed',
			message: `${error.message || 'Build failed before it could start.'} If this repeats, open a bug report with the console shown here.`,
			confirmLabel: 'Close',
		});
	}
}

function renderBuildDiagnostics(diagnostics) {
	buildDiagnostics.innerHTML = '';
	if (!diagnostics) {
		buildDiagnostics.hidden = true;
		return;
	}
	const fragments = [];

	if (diagnostics.selfHelp?.length) {
		const heading = document.createElement('h3');
		heading.textContent = 'How to fix this yourself';
		const list = document.createElement('ul');
		for (const hint of diagnostics.selfHelp) {
			const item = document.createElement('li');
			item.textContent = hint;
			list.appendChild(item);
		}
		fragments.push(heading, list);
	}

	if (diagnostics.bugReportUrl) {
		const para = document.createElement('p');
		para.className = 'diagnostics-bug';
		const link = document.createElement('a');
		link.href = diagnostics.bugReportUrl;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.textContent = 'Still stuck? Open a pre-filled bug report.';
		link.title = 'Opens a GitHub issue pre-filled with the failure details from this build.';
		para.appendChild(link);
		fragments.push(para);
	}

	buildDiagnostics.append(...fragments);
	buildDiagnostics.hidden = !fragments.length;
}

// ---- Server status & dataset list ----

async function refreshServerStatus() {
	try {
		const status = await api('/api/status');
		const size = status.databases.reduce((sum, db) => sum + db.bytes, 0);
		serverStatus.textContent = `${status.databases.length} database(s), ${formatBytes(size)} · building: ${status.building ? 'yes' : 'no'}`;
		refreshStatusButton.disabled = false;
		return status;
	} catch (error) {
		serverStatus.textContent = error.message || 'Server unreachable.';
		throw error;
	}
}

async function loadDatasetList() {
	try {
		const payload = await api('/api/datasets');
		availableDatasets = payload.databases.map(db => db.name).sort((a, b) => a.localeCompare(b));
		renderDatasetList();
		return payload;
	} catch (error) {
		showToast({ message: error.message, variant: 'error' });
	}
}

// ---- Dataset viewer (read-only) ----

function formatDatasetContents(contents) {
	return JSON.stringify(contents || {}, null, 2);
}

function renderDatasetList() {
	const sourceDatasets = availableDatasets.filter(name => !RESERVED_DATABASES.has(name));
	const systemDatasets = availableDatasets.filter(name => RESERVED_DATABASES.has(name));

	if (!availableDatasets.length) {
		datasetSummary.textContent = 'No datasets found.';
		datasetList.innerHTML = '<p class="dataset-empty">No datasets available yet — run a build first.</p>';
		selectedDataset.value = '';
		datasetEditor.value = '';
		editorHighlights.replaceChildren();
		activeDatasetName = '';
		return;
	}

	datasetSummary.textContent = `${sourceDatasets.length} source dataset(s), ${systemDatasets.length} system dataset(s).`;

	const renderGroup = (title, names, system) => {
		if (!names.length) return '';
		const chips = names
			.map(name => `<button class="dataset-chip ${system ? 'dataset-chip-system' : ''} ${name === activeDatasetName ? 'active' : ''}" type="button" data-dataset-name="${name}" title="${name}">${escapeHtml(prettyDatasetName(name))}</button>`)
			.join('');
		return `<section class="dataset-group"><p class="dataset-group-label">${title}</p><div class="dataset-row">${chips}</div></section>`;
	};

	datasetList.innerHTML = [renderGroup('Source datasets', sourceDatasets, false), renderGroup('System datasets', systemDatasets, true)].join('');
}

async function loadDataset(name) {
	const payload = await api(`/api/dataset?name=${encodeURIComponent(name)}`);
	activeDatasetName = name;
	selectedDataset.value = prettyDatasetName(name);
	datasetEditor.value = formatDatasetContents(payload.contents);
	renderDatasetList();
	const searchMatches = refreshSearchMatchesFor(datasetEditor, editorSearch, editorSearchCount);
	renderHighlights(datasetEditor, editorHighlights, searchMatches, editorSearch.value.trim());
	showToast({ message: `Loaded dataset: ${prettyDatasetName(name)}`, variant: 'success', timeout: 1800 });
}

// ---- Text search in textareas ----

function estimateCaretOffset(textarea, position) {
	const style = getComputedStyle(textarea);
	const fontSize = parseFloat(style.fontSize) || 12;
	const lineHeight = parseFloat(style.lineHeight) || fontSize;
	const width = textarea.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
	const charsPerLine = Math.max(1, Math.floor(width / (fontSize * 0.6)));
	const parts = textarea.value.slice(0, position).split('\n');
	let visualLines = 0;
	for (let i = 0; i < parts.length - 1; i++) visualLines += Math.max(1, Math.ceil(parts[i].length / charsPerLine));
	visualLines += Math.ceil(parts[parts.length - 1].length / charsPerLine);
	return { top: visualLines * lineHeight, height: lineHeight };
}

function scrollTextareaToPosition(textarea, position) {
	const { top } = estimateCaretOffset(textarea, position);
	const target = top - textarea.clientHeight / 3;
	textarea.scrollTop = Math.max(0, Math.min(target, textarea.scrollHeight - textarea.clientHeight));
}

function findMatches(text, query) {
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const matches = [];
	let start = 0;
	while (start < lowerText.length) {
		const index = lowerText.indexOf(lowerQuery, start);
		if (index === -1) break;
		matches.push(index);
		start = index + lowerQuery.length;
	}
	return matches;
}

function renderHighlights(textarea, highlightsEl, matches, query) {
	const value = textarea.value;
	const element = document.createDocumentFragment();
	let last = 0;
	if (matches.length) {
		for (const start of matches) {
			const end = Math.min(start + query.length, value.length);
			if (start > last) element.appendChild(document.createTextNode(value.slice(last, start)));
			const mark = document.createElement('mark');
			mark.textContent = value.slice(start, end);
			element.appendChild(mark);
			last = end;
		}
	}
	if (last < value.length) element.appendChild(document.createTextNode(value.slice(last)));
	highlightsEl.replaceChildren(element);
	highlightsEl.scrollTop = textarea.scrollTop;
	highlightsEl.scrollLeft = textarea.scrollLeft;
}

function refreshSearchMatchesFor(textarea, input, countEl) {
	const query = input.value.trim();
	if (!query) {
		countEl.textContent = '0 matches';
		return [];
	}
	const matches = findMatches(textarea.value, query);
	countEl.textContent = `${matches.length} match(es)`;
	return matches;
}

function makeSearchable({ textarea, input, prevButton, nextButton, countEl, jumpToggle, highlightsEl }) {
	let matches = [];
	let activeIndex = -1;

	const rebuild = () => {
		const next = refreshSearchMatchesFor(textarea, input, countEl);
		matches = next || [];
		renderHighlights(textarea, highlightsEl, matches, input.value.trim());
		if (activeIndex >= matches.length) activeIndex = -1;
		if (matches.length) {
			activeIndex = 0;
			focus();
		}
	};

	const focus = ({ force = false } = {}) => {
		if (!matches.length) return;
		if (!force && jumpToggle && !jumpToggle.checked) {
			countEl.textContent = `${activeIndex + 1}/${matches.length}`;
			return;
		}
		const start = matches[activeIndex];
		textarea.focus();
		textarea.setSelectionRange(start, Math.min(start + input.value.length, textarea.value.length));
		scrollTextareaToPosition(textarea, start);
		requestAnimationFrame(() => scrollTextareaToPosition(textarea, start));
		countEl.textContent = `${activeIndex + 1}/${matches.length}`;
	};

	const step = direction => {
		const found = refreshSearchMatchesFor(textarea, input, countEl);
		renderHighlights(textarea, highlightsEl, found, input.value.trim());
		if (!found?.length) {
			countEl.textContent = '0 matches';
			return;
		}
		matches = found;
		if (activeIndex < 0) activeIndex = 0;
		activeIndex = (activeIndex + direction + matches.length) % matches.length;
		focus({ force: true });
	};

	const schedule = () => {
		if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
		searchDebounceTimer = window.setTimeout(rebuild, 500);
	};

	input.addEventListener('input', schedule);
	textarea.addEventListener('input', schedule);
	textarea.addEventListener('input', () => {
		const query = input.value.trim();
		renderHighlights(textarea, highlightsEl, query ? findMatches(textarea.value, query) : [], query);
	});
	textarea.addEventListener('scroll', () => {
		highlightsEl.scrollTop = textarea.scrollTop;
		highlightsEl.scrollLeft = textarea.scrollLeft;
	});
	nextButton.addEventListener('click', () => {
		if (searchDebounceTimer) {
			window.clearTimeout(searchDebounceTimer);
			searchDebounceTimer = null;
		}
		step(1);
	});
	prevButton.addEventListener('click', () => {
		if (searchDebounceTimer) {
			window.clearTimeout(searchDebounceTimer);
			searchDebounceTimer = null;
		}
		step(-1);
	});
}

// ---- Source metadata (one row per source) ----

function contentsToMetadataRows(contents) {
	return Object.entries(contents || {})
		.map(([id, entry]) => ({
			id,
			name: entry?.name || '',
			description: entry?.description || '',
			defaultVersion: entry?.defaultVersion || '',
			editions: Object.entries(entry?.editions || {}).map(([version, edition]) => {
				const config = typeof edition === 'string' ? { fileKey: edition } : edition || {};
				return {
					version,
					fileKey: config.fileKey || '',
					sourceUrl: config.sourceUrl || '',
					altSourceUrl: config.altSourceUrl || '',
					altSourceLabel: config.altSourceLabel || '',
				};
			}),
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
}

function splitMachineWords(value) {
	return String(value || '')
		.split(/[_-]+/)
		.filter(Boolean)
		.map(part => (/^v\d+$/i.test(part) ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`));
}

function displayNameFromId(id) {
	return splitMachineWords(id).join(' ') || id;
}

function fileKeyDisplayName(key) {
	return splitMachineWords(key).join(' ') || key;
}

function fileKeyFromDisplay(display) {
	return String(display || '')
		.toLowerCase()
		.replace(/[\s-]+/g, '_')
		.replace(/[^a-z0-9_]/g, '')
		.replace(/_+/g, '_');
}

function metaBlankCell() {
	const td = document.createElement('td');
	td.className = 'meta-edition-blank';
	td.textContent = '—';
	return td;
}

function editionLinkCell(edition, field, placeholder) {
	const td = document.createElement('td');
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'meta-input';
	input.value = edition[field] || '';
	input.placeholder = placeholder;
	input.addEventListener('input', () => {
		edition[field] = input.value;
	});
	td.appendChild(input);
	return td;
}

function createMetaRowElement(row, index, hidden, singleEdition) {
	const tr = document.createElement('tr');
	tr.className = 'meta-source-row';
	if (hidden) tr.hidden = true;
	tr.dataset.metaIndex = String(index);

	const cell = field => {
		const td = document.createElement('td');
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'meta-input';
		if (field === 'id') {
			input.spellcheck = false;
			input.value = row.name || '';
			input.placeholder = displayNameFromId(row.id);
			input.title = `Internal id: ${row.id}`;
			input.addEventListener('input', () => {
				row.name = input.value;
			});
			const sub = document.createElement('span');
			sub.className = 'meta-id-sub';
			sub.textContent = row.id;
			sub.title = 'Internal id — fixed by the source folder name';
			td.appendChild(input);
			td.appendChild(sub);
			return td;
		}
		input.value = row[field] || '';
		input.addEventListener('input', () => {
			row[field] = input.value;
		});
		td.appendChild(input);
		return td;
	};

	const actionTd = document.createElement('td');
	const actionWrap = document.createElement('div');
	actionWrap.className = 'meta-actions';
	const addEditionButton = document.createElement('button');
	addEditionButton.type = 'button';
	addEditionButton.className = 'ghost-button meta-add-edition';
	addEditionButton.textContent = 'Add edition';
	addEditionButton.addEventListener('click', () => addEditionRowForSource(row.id));
	const removeButton = document.createElement('button');
	removeButton.type = 'button';
	removeButton.className = 'ghost-button meta-remove';
	removeButton.textContent = 'Remove';
	removeButton.dataset.metaIndex = String(index);
	removeButton.addEventListener('click', async () => {
		const confirmed = await showModal({
			title: 'Remove source?',
			message: `Remove source "${row.id}"? All its metadata and editions will be deleted.`,
			confirmLabel: 'Remove source',
			cancelLabel: 'Cancel',
			variant: 'danger',
			showCancel: true,
		});
		if (confirmed) {
			removeMetadataRow(index);
			markMetadataDirty();
		}
	});
	actionWrap.append(addEditionButton, removeButton);
	actionTd.appendChild(actionWrap);

	const urlCells = singleEdition
		? [
				editionLinkCell(singleEdition, 'sourceUrl', 'source URL'),
				editionLinkCell(singleEdition, 'altSourceUrl', 'alt source URL'),
				editionLinkCell(singleEdition, 'altSourceLabel', 'alt source label'),
			]
		: [metaBlankCell(), metaBlankCell(), metaBlankCell()];

	tr.append(cell('id'), cell('description'), ...urlCells, actionTd);
	return tr;
}

function createEditionRowElement(edition, hidden) {
	const tr = document.createElement('tr');
	tr.className = 'meta-edition-row';
	if (hidden) tr.hidden = true;

	const blankTd = () => {
		const td = document.createElement('td');
		td.className = 'meta-edition-blank';
		td.textContent = '—';
		return td;
	};

	const identityTd = document.createElement('td');
	const identity = document.createElement('div');
	identity.className = 'meta-edition-identity';
	const versionInput = document.createElement('input');
	versionInput.type = 'text';
	versionInput.className = 'meta-input meta-edition-version';
	versionInput.value = edition.version || '';
	versionInput.placeholder = 'default';
	versionInput.title = 'Edition version id';
	versionInput.spellcheck = false;
	versionInput.addEventListener('input', () => {
		edition.version = versionInput.value;
	});
	const fileKeyInput = document.createElement('input');
	fileKeyInput.type = 'text';
	fileKeyInput.className = 'meta-input meta-edition-filekey';
	fileKeyInput.value = fileKeyDisplayName(edition.fileKey);
	fileKeyInput.placeholder = 'file key';
	fileKeyInput.setAttribute('title', edition.fileKey || '');
	fileKeyInput.spellcheck = false;
	fileKeyInput.addEventListener('input', () => {
		edition.fileKey = fileKeyFromDisplay(fileKeyInput.value);
		fileKeyInput.title = edition.fileKey;
	});
	identity.append(versionInput, fileKeyInput);
	identityTd.appendChild(identity);

	const urlTd = document.createElement('td');
	const urlInput = document.createElement('input');
	urlInput.type = 'text';
	urlInput.className = 'meta-input';
	urlInput.value = edition.sourceUrl || '';
	urlInput.placeholder = 'edition source URL';
	urlInput.addEventListener('input', () => {
		edition.sourceUrl = urlInput.value;
	});
	urlTd.appendChild(urlInput);

	const altUrlTd = document.createElement('td');
	const altUrlInput = document.createElement('input');
	altUrlInput.type = 'text';
	altUrlInput.className = 'meta-input';
	altUrlInput.value = edition.altSourceUrl || '';
	altUrlInput.placeholder = 'alt source URL';
	altUrlInput.addEventListener('input', () => {
		edition.altSourceUrl = altUrlInput.value;
	});
	altUrlTd.appendChild(altUrlInput);

	const altLabelTd = document.createElement('td');
	const altLabelInput = document.createElement('input');
	altLabelInput.type = 'text';
	altLabelInput.className = 'meta-input';
	altLabelInput.value = edition.altSourceLabel || '';
	altLabelInput.placeholder = 'alt source label';
	altLabelInput.addEventListener('input', () => {
		edition.altSourceLabel = altLabelInput.value;
	});
	altLabelTd.appendChild(altLabelInput);

	const actionTd = document.createElement('td');
	const actionWrap = document.createElement('div');
	actionWrap.className = 'meta-actions';
	const defaultRadio = document.createElement('input');
	defaultRadio.type = 'radio';
	defaultRadio.className = 'meta-edition-default';
	defaultRadio.name = `meta-default-${edition.sourceId}`;
	defaultRadio.title = 'Set as the source\'s default edition';
	defaultRadio.checked = Boolean(edition.version && edition.defaultVersion === edition.version);
	defaultRadio.addEventListener('change', () => {
		edition.defaultVersion = edition.version;
	});
	const removeButton = document.createElement('button');
	removeButton.type = 'button';
	removeButton.className = 'ghost-button meta-remove';
	removeButton.textContent = 'Remove';
	removeButton.addEventListener('click', () => removeEditionRow(edition));
	actionWrap.append(defaultRadio, removeButton);
	actionTd.appendChild(actionWrap);

	tr.append(identityTd, blankTd(), urlTd, altUrlTd, altLabelTd, actionTd);
	return tr;
}

function renderMetadataTable() {
	const query = metadataSearch.value.trim().toLowerCase();
	let visible = 0;
	metadataTableBody.innerHTML = '';
	const fragments = [];
	metadataRows.forEach((row, index) => {
		const editions = editionRows.filter(edition => edition.sourceId === row.id);
		const singleEdition = editions.length === 1 ? editions[0] : null;
		const sourceHaystack = [row.id, row.description].join(' ').toLowerCase();
		const sourceMatches = !query || sourceHaystack.includes(query);
		const editionMatchesAny = editions.some(edition =>
			[edition.version, fileKeyDisplayName(edition.fileKey), edition.sourceUrl, edition.altSourceUrl, edition.altSourceLabel].join(' ').toLowerCase().includes(query),
		);
		const sourceHidden = Boolean(query && !sourceMatches && !editionMatchesAny);
		if (!sourceHidden) visible += 1;
		fragments.push(createMetaRowElement(row, index, sourceHidden, singleEdition));
		if (!singleEdition) {
			for (const edition of editions) {
				const editionHaystack = [edition.version, fileKeyDisplayName(edition.fileKey), edition.sourceUrl, edition.altSourceUrl, edition.altSourceLabel].join(' ').toLowerCase();
				const hidden = Boolean(query && !sourceMatches && !editionHaystack.includes(query));
				fragments.push(createEditionRowElement(edition, hidden));
			}
		}
	});
	metadataTableBody.append(...fragments);
	metadataSearchCount.textContent = query ? `${visible} of ${metadataRows.length} sources` : `${metadataRows.length} sources`;
}

let metadataDirty = false;
let metadataAutoSaveTimer = null;
function markMetadataDirty() {
	metadataDirty = true;
	scheduleMetadataSave();
}
function scheduleMetadataSave() {
	if (!metadataDirty) return;
	if (metadataAutoSaveTimer) clearTimeout(metadataAutoSaveTimer);
	metadataAutoSaveTimer = setTimeout(() => {
		metadataAutoSaveTimer = null;
		saveSourceMetadata();
	}, 900);
}

function removeMetadataRow(index) {
	metadataRows.splice(index, 1);
	editionRows = editionRows.filter(edition => metadataRows.some(row => row.id === edition.sourceId));
	renderMetadataTable();
}

// ---- Editions (dedicated table) ----

function flattenEditionRows() {
	const rows = [];
	for (const row of metadataRows) {
		for (const edition of row.editions || []) {
			rows.push({ sourceId: row.id, version: edition.version, fileKey: edition.fileKey, sourceUrl: edition.sourceUrl, altSourceUrl: edition.altSourceUrl, altSourceLabel: edition.altSourceLabel, defaultVersion: row.defaultVersion });
		}
	}
	return rows;
}

function addEditionRowForSource(sourceId) {
	const row = metadataRows.find(meta => meta.id === sourceId);
	editionRows.push({ sourceId, version: '', fileKey: '', sourceUrl: '', altSourceUrl: '', altSourceLabel: '', defaultVersion: row?.defaultVersion || '' });
	renderMetadataTable();
	const newRow = [...metadataTableBody.querySelectorAll('tr.meta-edition-row')].pop();
	newRow?.querySelector('.meta-edition-version')?.focus();
	markMetadataDirty();
}

function removeEditionRow(edition) {
	const index = editionRows.indexOf(edition);
	if (index !== -1) editionRows.splice(index, 1);
	renderMetadataTable();
	markMetadataDirty();
}

function applyEditionRowsToMetadataRows() {
	for (const row of metadataRows) {
		const rowEditions = editionRows.filter(edition => edition.sourceId === row.id && edition.version.trim() && edition.fileKey.trim());
		row.editions = rowEditions.map(edition => ({
			version: edition.version.trim(),
			fileKey: edition.fileKey.trim(),
			sourceUrl: cleanSourceUrl(edition.sourceUrl),
			altSourceUrl: cleanSourceUrl(edition.altSourceUrl),
			altSourceLabel: edition.altSourceLabel.trim(),
		}));
		const defaultEdition =
			rowEditions.find(edition => edition.defaultVersion === edition.version) || rowEditions.find(edition => edition.version === 'default');
		row.defaultVersion = defaultEdition ? defaultEdition.version : rowEditions.length ? rowEditions[0].version : '';
	}
}

function metadataRowsToContents() {
	const contents = {};
	const seen = new Set();
	for (const row of metadataRows) {
		const id = row.id.trim();
		if (!id) continue;
		if (seen.has(id)) throw new Error(`Duplicate source ID: ${id}`);
		seen.add(id);
		const entry = {};
		if (row.name.trim()) entry.name = row.name.trim();
		if (row.description.trim()) entry.description = row.description.trim();
		if (row.editions.length) {
			entry.editions = Object.fromEntries(
				row.editions.map(edition => {
					const value = { fileKey: edition.fileKey, sourceUrl: cleanSourceUrl(edition.sourceUrl) };
					if (edition.altSourceUrl && edition.altSourceLabel) {
						value.altSourceUrl = edition.altSourceUrl;
						value.altSourceLabel = edition.altSourceLabel;
					}
					return [edition.version, value];
				}),
			);
			if (row.defaultVersion && row.editions.some(edition => edition.version === row.defaultVersion)) entry.defaultVersion = row.defaultVersion;
		}
		contents[id] = entry;
	}
	return contents;
}

async function loadSourceMetadata() {
	metadataDirty = false;
	if (metadataAutoSaveTimer) {
		clearTimeout(metadataAutoSaveTimer);
		metadataAutoSaveTimer = null;
	}
	const payload = await api('/api/source-metadata');
	metadataRows = contentsToMetadataRows(payload.contents);
	editionRows = flattenEditionRows();
	renderMetadataTable();
}

async function saveSourceMetadata() {
	if (!metadataDirty) return;
	applyEditionRowsToMetadataRows();
	let parsed;
	try {
		parsed = metadataRowsToContents();
	} catch (error) {
		showToast({ message: error.message, variant: 'error' });
		return;
	}
	try {
		await api('/api/source-metadata', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(parsed),
		});
		metadataDirty = false;
		showToast({ message: 'Source metadata saved.', variant: 'success', timeout: 1800 });
	} catch (error) {
		showToast({ message: error.message, variant: 'error' });
	}
}

// ---- Add-source modal ----

function slugify(value) {
	return String(value ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/^Copy of\s*/i, '')
		.replace(/['’]/g, '')
		.replace(/&/g, ' and ')
		.replace(/[^a-zA-Z0-9_-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}

function cleanSourceUrl(url) {
	const trimmed = String(url || '').trim();
	if (!trimmed) return '';
	try {
		const parsed = new URL(trimmed);
		parsed.search = '';
		parsed.hash = '';
		let pathname = parsed.pathname;
		if (parsed.hostname.endsWith('docs.google.com') && /\/edit$/i.test(pathname)) {
			pathname = pathname.replace(/\/edit$/i, '');
		}
		return parsed.origin + pathname;
	} catch {
		return trimmed;
	}
}

function sourceNameFromFile(fileName) {
	const basename = String(fileName || '').replace(/\.[^.]+$/, '');
	const segments = basename
		.split(/[-:_]/)
		.map(s => s.trim())
		.filter(Boolean);
	if (segments.length <= 1) return basename.trim();
	return segments.slice(0, -1).join(' - ').trim();
}

let stagedSourceFiles = [];

function updateSourceModalState() {
	const name = sourceModalName.value.trim();
	sourceModalSlug.textContent = slugify(name) || '—';
}

function openSourceModal() {
	sourceModalName.value = '';
	sourceModalUrl.value = '';
	sourceModalDesc.value = '';
	sourceModalUpload.value = '';
	stagedSourceFiles = [];
	renderStagedFileList();
	updateSourceModalState();
	sourceModal.hidden = false;
	sourceModalName.focus();
}

function closeSourceModal() {
	sourceModal.hidden = true;
	sourceModalUpload.value = '';
	stagedSourceFiles = [];
	renderStagedFileList();
}

async function stageModalFiles(files) {
	for (const file of Array.from(files || [])) {
		const content = await file.text();
		if (!content.trim()) {
			showToast({ message: `Skipped empty file: ${file.name}`, variant: 'info', timeout: 1800 });
			continue;
		}
		if (!stagedSourceFiles.some(staged => staged.name === file.name)) {
			stagedSourceFiles.push({ name: file.name, content });
		}
	}
	if (!sourceModalName.value.trim() && stagedSourceFiles.length) {
		sourceModalName.value = sourceNameFromFile(stagedSourceFiles[0].name);
	}
	sourceModalUpload.value = '';
	updateSourceModalState();
	renderStagedFileList();
}

function renderStagedFileList() {
	sourceModalStagedFiles.innerHTML = '';
	for (const staged of stagedSourceFiles) {
		const row = document.createElement('div');
		row.className = 'staged-file';
		const name = document.createElement('span');
		name.textContent = staged.name;
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'ghost-button remove-file';
		remove.textContent = 'Remove';
		remove.addEventListener('click', () => {
			stagedSourceFiles = stagedSourceFiles.filter(item => item !== staged);
			renderStagedFileList();
		});
		row.append(name, remove);
		sourceModalStagedFiles.appendChild(row);
	}
}

async function saveSourceModal() {
	const name = sourceModalName.value.trim();
	const sourceUrl = cleanSourceUrl(sourceModalUrl.value);
	const description = sourceModalDesc.value.trim();
	if (!name || !sourceUrl || !description) {
		showToast({ message: 'Name, source URL, and description are required.', variant: 'error' });
		updateSourceModalState();
		return;
	}
	const sourceId = slugify(name);
	if (!sourceId) {
		showToast({ message: 'The source name did not produce a valid folder id.', variant: 'error' });
		sourceModalName.focus();
		return;
	}
	if (metadataRows.some(row => row.id === sourceId)) {
		showToast({ message: `Source "${sourceId}" already exists.`, variant: 'error' });
		return;
	}
	await withBusy(
		saveSourceModalButton,
		async () => {
			await api(`/api/sources/${encodeURIComponent(sourceId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
			for (const staged of stagedSourceFiles) {
				await api(`/api/sources/${encodeURIComponent(sourceId)}/files/${encodeURIComponent(staged.name)}`, { method: 'PUT', body: staged.content });
			}
			const current = await api('/api/source-metadata');
			const contents = current.contents || {};
			contents[sourceId] = {
				...(contents[sourceId] || {}),
				name,
				description,
				defaultVersion: 'default',
				editions: { default: { fileKey: sourceId, sourceUrl } },
			};
			await api('/api/source-metadata', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(contents),
			});
			closeSourceModal();
			await loadSourceMetadata();
			showToast({ message: `Created source "${sourceId}".`, variant: 'success' });
		},
		'Creating...',
	).catch(error => showToast({ message: error.message, variant: 'error' }));
}

// ---- Keyword filter (one keyword per line) ----

let keywordDirty = false;
let keywordAutoSaveTimer = null;
function markKeywordDirty() {
	keywordDirty = true;
	scheduleKeywordSave();
}
function scheduleKeywordSave() {
	if (!keywordDirty) return;
	if (keywordAutoSaveTimer) clearTimeout(keywordAutoSaveTimer);
	keywordAutoSaveTimer = setTimeout(() => {
		keywordAutoSaveTimer = null;
		saveKeywordFilter();
	}, 900);
}

async function loadKeywordFilter() {
	keywordDirty = false;
	if (keywordAutoSaveTimer) {
		clearTimeout(keywordAutoSaveTimer);
		keywordAutoSaveTimer = null;
	}
	const payload = await api('/api/config/keyword-filter');
	keywordFilterEditor.value = (payload.contents?.keywords || []).join('\n');
	const searchMatches = refreshSearchMatchesFor(keywordFilterEditor, keywordSearch, keywordSearchCount);
	renderHighlights(keywordFilterEditor, keywordHighlights, searchMatches, keywordSearch.value.trim());
}

async function saveKeywordFilter() {
	if (!keywordDirty) return;
	const keywords = keywordFilterEditor.value.split('\n').map(keyword => keyword.trim()).filter(Boolean);
	try {
		await api('/api/config/keyword-filter', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ keywords }),
		});
		keywordDirty = false;
		showToast({ message: `Keyword filter saved (${keywords.length} keyword(s)).`, variant: 'success', timeout: 1800 });
	} catch (error) {
		showToast({ message: error.message, variant: 'error' });
	}
}

async function loadDatasetVersion() {
	const payload = await api('/api/config/dataset');
	datasetVersionInput.value = payload.contents?.datasetVersion || '';
}

async function saveDatasetVersion() {
	const datasetVersion = datasetVersionInput.value.trim();
	if (!datasetVersion) {
		showToast({ message: 'Dataset version cannot be empty.', variant: 'error' });
		return;
	}
	try {
		await api('/api/config/dataset', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ datasetVersion }),
		});
		showToast({ message: `Dataset version saved: ${datasetVersion}.`, variant: 'success', timeout: 1800 });
	} catch (error) {
		showToast({ message: error.message, variant: 'error' });
	}
}

// ---- Wiring ----

buildButton.addEventListener('click', () => withBusy(buildButton, runBuild, 'Building...'));

clearLogsButton.addEventListener('click', async () => {
	const confirmed = await showModal({
		title: 'Clear Logs',
		message: 'Remove all current log lines?',
		confirmLabel: 'Clear',
		cancelLabel: 'Keep',
		variant: 'danger',
		showCancel: true,
	});
	if (confirmed) {
		clearConsole();
		showToast({ message: 'Logs cleared.', variant: 'success', timeout: 1800 });
	}
});

refreshStatusButton.addEventListener('click', () => withBusy(refreshStatusButton, refreshServerStatus, '…'));

refreshDatasetsButton.addEventListener('click', () => withBusy(refreshDatasetsButton, loadDatasetList, 'Loading...'));

addMetaRowButton.addEventListener('click', openSourceModal);
metadataSearch.addEventListener('input', renderMetadataTable);
reloadSourceMetadataButton.addEventListener('click', () => withBusy(reloadSourceMetadataButton, loadSourceMetadata, 'Loading...'));
metadataTableBody.addEventListener('input', markMetadataDirty);
metadataTableBody.addEventListener('focusout', scheduleMetadataSave);
closeSourceModalButton.addEventListener('click', closeSourceModal);
saveSourceModalButton.addEventListener('click', saveSourceModal);
sourceModalName.addEventListener('input', updateSourceModalState);
sourceModalUrl.addEventListener('input', updateSourceModalState);
sourceModalDesc.addEventListener('input', updateSourceModalState);
sourceModalUpload.addEventListener('change', () => {
	const pending = stageModalFiles(sourceModalUpload.files);
	pending.catch(error => showToast({ message: error.message, variant: 'error' }));
});
sourceModalUploadSection.addEventListener('click', () => sourceModalUpload.click());
['dragenter', 'dragover'].forEach(type => sourceModalUploadSection.addEventListener(type, event => {
	event.preventDefault();
	sourceModalUploadSection.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(type => sourceModalUploadSection.addEventListener(type, event => {
	event.preventDefault();
	sourceModalUploadSection.classList.remove('dragover');
}));
sourceModalUploadSection.addEventListener('drop', event => {
	const pending = stageModalFiles(event.dataTransfer.files);
	pending.catch(error => showToast({ message: error.message, variant: 'error' }));
});

reloadKeywordFilterButton.addEventListener('click', () => withBusy(reloadKeywordFilterButton, loadKeywordFilter, 'Loading...'));
keywordFilterEditor.addEventListener('input', markKeywordDirty);
keywordFilterEditor.addEventListener('focusout', scheduleKeywordSave);

saveDatasetConfigButton.addEventListener('click', () => withBusy(saveDatasetConfigButton, saveDatasetVersion, 'Saving...'));
datasetVersionInput.addEventListener('keydown', event => {
	if (event.key === 'Enter') saveDatasetConfigButton.click();
});

datasetList.addEventListener('click', event => {
	const button = event.target.closest('[data-dataset-name]');
	if (!button) return;
	withBusy(button, () => loadDataset(button.dataset.datasetName).catch(error => showToast({ message: error.message, variant: 'error' })), 'Loading');
});

clearDatasetSelectionButton.addEventListener('click', () => {
	activeDatasetName = '';
	selectedDataset.value = '';
	datasetEditor.value = '';
	editorHighlights.replaceChildren();
	renderDatasetList();
});

reloadDatasetButton.addEventListener('click', () => {
	if (!activeDatasetName) {
		showToast({ message: 'Select a dataset first.', variant: 'info', timeout: 1800 });
		return;
	}
	withBusy(reloadDatasetButton, () => loadDataset(activeDatasetName), 'Reloading...').catch(error => showToast({ message: error.message, variant: 'error' }));
});

[tabHome, tabBuild, tabSourceMetadata, tabKeywordFilter, tabDatasets].forEach(button => {
	button.addEventListener('click', () => switchTab(button.dataset.tab));
});

paneHome.addEventListener('click', event => {
	const jump = event.target.closest('[data-tab]');
	if (jump) switchTab(jump.dataset.tab);
});

makeSearchable({ textarea: datasetEditor, input: editorSearch, prevButton: editorSearchPrev, nextButton: editorSearchNext, countEl: editorSearchCount, jumpToggle: editorJump, highlightsEl: editorHighlights });
makeSearchable({ textarea: keywordFilterEditor, input: keywordSearch, prevButton: keywordSearchPrev, nextButton: keywordSearchNext, countEl: keywordSearchCount, jumpToggle: keywordJump, highlightsEl: keywordHighlights });

switchTab('home');

loadDatasetList().catch(() => {});
refreshServerStatus()
	.catch(() => {
		serverStatus.textContent = 'Server unreachable. Check that the web panel is running.';
	})
	.then(() => loadSourceMetadata().catch(() => {}))
	.then(() => loadKeywordFilter().catch(() => {}))
	.then(() => loadDatasetVersion().catch(() => {}));

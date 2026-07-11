const form = document.querySelector('#convertForm');
const filesInput = document.querySelector('#files');
const folderInput = document.querySelector('#folderFiles');
const chooseFolder = document.querySelector('#chooseFolder');
const clearFolders = document.querySelector('#clearFolders');
const folderCount = document.querySelector('#folderCount');
const fileCount = document.querySelector('#fileCount');
const convertButton = document.querySelector('#convertButton');
const runState = document.querySelector('#runState');
const metrics = document.querySelector('#metrics');
const outputs = document.querySelector('#outputs');
const logs = document.querySelector('#logs');
const clearLogs = document.querySelector('#clearLogs');
const refreshStatus = document.querySelector('#refreshStatus');
const databaseStatus = document.querySelector('#databaseStatus');
const refreshDatasets = document.querySelector('#refreshDatasets');
const datasetSummary = document.querySelector('#datasetSummary');
const datasetList = document.querySelector('#datasetList');
const selectedDataset = document.querySelector('#selectedDataset');
const clearDatasetSelection = document.querySelector('#clearDatasetSelection');
const datasetIsAdult = document.querySelector('#datasetIsAdult');
const datasetEditor = document.querySelector('#datasetEditor');
const reloadDataset = document.querySelector('#reloadDataset');
const saveDataset = document.querySelector('#saveDataset');
const editorSearch = document.querySelector('#editorSearch');
const editorSearchPrev = document.querySelector('#editorSearchPrev');
const editorSearchNext = document.querySelector('#editorSearchNext');
const editorSearchCount = document.querySelector('#editorSearchCount');
const categoryIdDisplay = document.querySelector('#categoryIdDisplay');
const categoryDisplayLabel = document.querySelector('#categoryDisplayLabel');
const addVersionRow = document.querySelector('#addVersionRow');
const versionRowsContainer = document.querySelector('#versionRowsContainer');
const categoryDefaultVersionSelect = document.querySelector('#categoryDefaultVersionSelect');
const saveCategoryVersions = document.querySelector('#saveCategoryVersions');
const versionBuilderBlock = document.querySelector('#versionBuilderBlock');
const versionBuilderNotice = document.querySelector('#versionBuilderNotice');
const tabUpload = document.querySelector('#tabUpload');
const tabDatasets = document.querySelector('#tabDatasets');
const paneUpload = document.querySelector('#paneUpload');
const paneDatasets = document.querySelector('#paneDatasets');
const dropzone = document.querySelector('#dropzone');
const appModal = document.querySelector('#appModal');
const appModalTitle = document.querySelector('#appModalTitle');
const appModalMessage = document.querySelector('#appModalMessage');
const appModalConfirm = document.querySelector('#appModalConfirm');
const appModalCancel = document.querySelector('#appModalCancel');
const appModalClose = document.querySelector('#appModalClose');
const toastRack = document.querySelector('#toastRack');

const RESERVED_DATABASES = new Set(['dataset', 'categories', 'sources', 'database_backup']);

let modalResolver = null;
let modalKeyHandler = null;
let modalLastFocused = null;
let pickedFolderEntries = [];
let pickedFolderNames = new Set();
let availableDatasets = [];
let activeDatasetName = '';
let searchMatches = [];
let activeSearchMatchIndex = -1;
let searchDebounceTimer = null;

function setButtonBusy(button, busy, busyLabel) {
	if (!button) return;
	if (busy) {
		if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
		button.disabled = true;
		button.classList.add('is-busy');
		button.setAttribute('aria-busy', 'true');
		if (busyLabel) button.textContent = busyLabel;
		return;
	}
	button.disabled = false;
	button.classList.remove('is-busy');
	button.removeAttribute('aria-busy');
	if (button.dataset.originalLabel) {
		button.textContent = button.dataset.originalLabel;
		delete button.dataset.originalLabel;
	}
}

async function withBusy(button, work, busyLabel) {
	setButtonBusy(button, true, busyLabel);
	try {
		return await work();
	} finally {
		setButtonBusy(button, false);
	}
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
	if (modalLastFocused?.focus) {
		modalLastFocused.focus();
	}
	resolve(result);
}

function showModal(options = {}) {
	if (modalResolver) {
		closeModal(false);
	}

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
		if (showCancel) {
			appModalCancel.onclick = () => closeModal(false);
		}

		if (allowDismiss) {
			appModalClose.onclick = () => closeModal(false);
		}

		appModal.onclick = event => {
			if (allowDismiss && event.target?.dataset?.modalClose === 'backdrop') {
				closeModal(false);
			}
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

function showToast(options = {}) {
	const { message = '', variant = 'info', timeout = 3200 } = options;
	if (!message) return;

	const toast = document.createElement('div');
	toast.className = `toast toast-${variant}`;

	const text = document.createElement('p');
	text.textContent = message;

	const closeButton = document.createElement('button');
	closeButton.type = 'button';
	closeButton.setAttribute('aria-label', 'Dismiss notification');
	closeButton.textContent = 'X';

	toast.append(text, closeButton);
	toastRack.appendChild(toast);

	const removeToast = () => {
		if (toast.parentNode) {
			toast.parentNode.removeChild(toast);
		}
	};

	closeButton.addEventListener('click', removeToast);
	window.setTimeout(removeToast, timeout);
}

function switchTab(tabName) {
	const uploadActive = tabName === 'upload';
	tabUpload.classList.toggle('active', uploadActive);
	tabDatasets.classList.toggle('active', !uploadActive);
	paneUpload.classList.toggle('active', uploadActive);
	paneDatasets.classList.toggle('active', !uploadActive);
}

function selectedFiles() {
	const fileEntries = [...filesInput.files].map(file => ({
		file,
		relativePath: file.webkitRelativePath || file.name,
	}));
	return [...fileEntries, ...pickedFolderEntries];
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

function setRunState(label, mode) {
	runState.textContent = label;
	runState.className = `status-pill ${mode}`;
}

function updateFileCount() {
	const count = selectedFiles().length;
	fileCount.textContent = count ? `${count} selected` : 'No files selected';
	folderCount.textContent = pickedFolderEntries.length ? `${pickedFolderNames.size} folder(s), ${pickedFolderEntries.length} file(s)` : 'No folder selected';
}

function mergeFolderEntries(entries) {
	if (!entries.length) return { added: 0 };

	const byPath = new Map(pickedFolderEntries.map(entry => [entry.relativePath, entry]));
	let added = 0;
	for (const entry of entries) {
		if (!byPath.has(entry.relativePath)) {
			added += 1;
		}
		byPath.set(entry.relativePath, entry);
		const rootFolder = entry.relativePath.split('/')[0];
		if (rootFolder) pickedFolderNames.add(rootFolder);
	}
	pickedFolderEntries = [...byPath.values()];
	return { added };
}

function clearFolderQueue() {
	pickedFolderEntries = [];
	pickedFolderNames = new Set();
	folderInput.value = '';
	updateFileCount();
}

function renderMetrics(report) {
	const items = [
		['Perks', report?.perkCount || 0],
		['Adult', report?.adultPerkCount || 0],
		['Sources', report?.sourceCount || 0],
		['Errors', report?.validationErrorCount || 0],
		['Categories', report?.categoryCount || 0],
		['Chapters', report?.chapterCount || 0],
		['Databases', report?.databaseCount || 0],
		['Storage', report?.nyaDbDatabaseCount || 0],
	];

	metrics.innerHTML = items
		.map(
			([label, value]) => `
			<div class="metric">
				<span>${label}</span>
				<strong>${Number(value).toLocaleString()}</strong>
			</div>
		`,
		)
		.join('');
}

function renderOutputs(job) {
	if (!job?.outputFiles?.length) {
		outputs.innerHTML = '';
		return;
	}

	outputs.innerHTML = job.outputFiles
		.map(
			file => `
			<a class="output-link" href="/api/download?job=${encodeURIComponent(job.id)}&file=${encodeURIComponent(file.name)}">
				<span>${file.name}</span>
				<span>${formatBytes(file.bytes)}</span>
			</a>
		`,
		)
		.join('');
}

function renderLogs(entries, error) {
	const lines = [];
	if (error) lines.push(`[error] ${error}`);
	for (const entry of entries || []) {
		lines.push(`[${entry.level}] ${entry.message}`);
	}
	logs.textContent = lines.join('\n') || 'Ready.';
	logs.scrollTop = logs.scrollHeight;
}

function splitMachineWords(value) {
	return String(value || '')
		.split(/[_-]+/)
		.filter(Boolean)
		.map(part => (/^v\d+$/i.test(part) ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`));
}

function suggestVersionFromDatabase(name) {
	const machine = String(name || '').toLowerCase();
	const parts = machine.split(/[_-]+/).filter(Boolean);
	if (!parts.length) {
		return {
			categoryId: machine,
			versionId: 'default',
			categoryDisplayName: machine,
		};
	}

	let categoryId = machine;
	let versionId = 'default';
	if (parts.length > 1) {
		const tail = parts[parts.length - 1];
		if (/^v\d+$/i.test(tail)) {
			categoryId = parts.slice(0, -1).join('_');
			versionId = tail.toLowerCase();
		} else {
			categoryId = parts[0];
			versionId = parts.slice(1).join('_');
		}
	}

	const categoryDisplayName = splitMachineWords(categoryId).join(' ') || categoryId;
	return {
		categoryId,
		versionId,
		categoryDisplayName,
	};
}

function datasetOptionsForVersions() {
	return availableDatasets.filter(name => !RESERVED_DATABASES.has(name));
}

function forEachPerk(dataset, onPerk) {
	if (!dataset || typeof dataset !== 'object') return;
	for (const sourceEntry of Object.values(dataset)) {
		const chapters = sourceEntry?.chapters;
		if (!chapters || typeof chapters !== 'object') continue;
		for (const chapterEntry of Object.values(chapters)) {
			const perksByKey = chapterEntry?.perks;
			if (!perksByKey || typeof perksByKey !== 'object') continue;
			for (const perkList of Object.values(perksByKey)) {
				if (!Array.isArray(perkList)) continue;
				for (const perk of perkList) {
					if (perk && typeof perk === 'object') onPerk(perk);
				}
			}
		}
	}
}

function getDatasetAdultState(dataset) {
	let total = 0;
	let adult = 0;
	forEachPerk(dataset, perk => {
		total += 1;
		if (perk.isAdult === true) adult += 1;
	});
	if (!total) return { hasPerks: false, mixed: false, isAdult: false };
	if (adult === 0) return { hasPerks: true, mixed: false, isAdult: false };
	if (adult === total) return { hasPerks: true, mixed: false, isAdult: true };
	return { hasPerks: true, mixed: true, isAdult: false };
}

function applyDatasetAdultState(dataset, isAdult) {
	forEachPerk(dataset, perk => {
		perk.isAdult = Boolean(isAdult);
	});
}

function clearSelectedDataset(notify = false) {
	activeDatasetName = '';
	selectedDataset.value = '';
	datasetEditor.value = '';
	datasetIsAdult.checked = false;
	datasetIsAdult.indeterminate = false;
	datasetIsAdult.disabled = true;
	searchMatches = [];
	activeSearchMatchIndex = -1;
	editorSearchCount.textContent = '0 matches';
	recomputeVersionBuilderState();
	renderDatasetList(availableDatasets);
	updateDatasetModeState();
	if (notify) showToast({ message: 'Dataset selection cleared.', variant: 'info', timeout: 1600 });
}

function updateDatasetModeState() {
	const isSystemDataset = Boolean(activeDatasetName && RESERVED_DATABASES.has(activeDatasetName));
	if (versionBuilderBlock) {
		versionBuilderBlock.hidden = isSystemDataset;
	}
	if (versionBuilderNotice) {
		versionBuilderNotice.hidden = !isSystemDataset;
	}
}

function scheduleSearchUpdate() {
	if (searchDebounceTimer) {
		window.clearTimeout(searchDebounceTimer);
	}
	searchDebounceTimer = window.setTimeout(() => {
		searchDebounceTimer = null;
		updateSearchMatches();
	}, 500);
}

function flushSearchUpdate() {
	if (!searchDebounceTimer) return;
	window.clearTimeout(searchDebounceTimer);
	searchDebounceTimer = null;
	updateSearchMatches();
}

function createVersionRow(initial = {}) {
	const wrapper = document.createElement('div');
	wrapper.className = 'version-row';

	const select = document.createElement('select');
	select.className = 'version-dataset';
	const available = datasetOptionsForVersions();
	select.innerHTML = [`<option value="">Select dataset</option>`, ...available.map(name => `<option value="${name}">${name}</option>`)].join('');
	if (initial.database && available.includes(initial.database)) {
		select.value = initial.database;
	}

	const versionInput = document.createElement('input');
	versionInput.type = 'text';
	versionInput.className = 'version-id';
	versionInput.placeholder = 'version id';
	versionInput.value = initial.versionId || '';

	const removeButton = document.createElement('button');
	removeButton.type = 'button';
	removeButton.className = 'ghost-button';
	removeButton.textContent = 'Remove';

	const updateFromSelection = () => {
		if (!select.value) return;
		const suggestion = suggestVersionFromDatabase(select.value);
		if (!versionInput.value.trim()) {
			versionInput.value = suggestion.versionId;
		}
		recomputeVersionBuilderState();
	};

	select.addEventListener('change', updateFromSelection);
	versionInput.addEventListener('input', recomputeVersionBuilderState);
	removeButton.addEventListener('click', () => {
		wrapper.remove();
		recomputeVersionBuilderState();
	});

	wrapper.append(select, versionInput, removeButton);
	versionRowsContainer.appendChild(wrapper);
	updateFromSelection();
}

function collectVersionRows() {
	return [...versionRowsContainer.querySelectorAll('.version-row')]
		.map(row => ({
			database: row.querySelector('.version-dataset')?.value || '',
			versionId: row.querySelector('.version-id')?.value.trim().toLowerCase() || '',
		}))
		.filter(row => row.database && row.versionId);
}

function recomputeVersionBuilderState() {
	const rows = collectVersionRows();
	const categoryIds = [...new Set(rows.map(row => suggestVersionFromDatabase(row.database).categoryId))];

	if (!rows.length) {
		categoryIdDisplay.value = '';
		categoryDisplayLabel.value = '';
		categoryDefaultVersionSelect.innerHTML = '<option value="">Default version</option>';
		saveCategoryVersions.disabled = true;
		return;
	}

	const categoryInfo = suggestVersionFromDatabase(rows[0].database);
	categoryIdDisplay.value = categoryInfo.categoryId;
	categoryDisplayLabel.value = categoryIds.length === 1 ? categoryInfo.categoryDisplayName : `${categoryInfo.categoryDisplayName} (mixed sources)`;

	const versions = [...new Set(rows.map(row => row.versionId))].sort((a, b) => a.localeCompare(b));
	const existingDefault = categoryDefaultVersionSelect.value;
	categoryDefaultVersionSelect.innerHTML = versions.map(version => `<option value="${version}">${version}</option>`).join('');
	if (versions.includes(existingDefault)) {
		categoryDefaultVersionSelect.value = existingDefault;
	}
	saveCategoryVersions.disabled = !rows.length;
}

function renderDatasetList(databases) {
	availableDatasets = [...(databases || [])].sort((a, b) => a.localeCompare(b));
	const sourceDatasets = availableDatasets.filter(name => !RESERVED_DATABASES.has(name));
	const systemDatasets = availableDatasets.filter(name => RESERVED_DATABASES.has(name));
	if (activeDatasetName && !availableDatasets.includes(activeDatasetName)) {
		activeDatasetName = '';
		selectedDataset.value = '';
		datasetEditor.value = '';
		datasetIsAdult.checked = false;
		datasetIsAdult.indeterminate = false;
		datasetIsAdult.disabled = true;
	}
	if (!availableDatasets.length) {
		datasetSummary.textContent = 'No datasets found.';
		datasetList.innerHTML = '<p class="dataset-empty">No datasets available yet.</p>';
		selectedDataset.value = '';
		datasetEditor.value = '';
		activeDatasetName = '';
		datasetIsAdult.checked = false;
		datasetIsAdult.indeterminate = false;
		datasetIsAdult.disabled = true;
		recomputeVersionBuilderState();
		return;
	}

	datasetSummary.textContent = `${sourceDatasets.length} source dataset(s), ${systemDatasets.length} system dataset(s).`;

	const renderGroup = (title, names, system) => {
		if (!names.length) return '';
		const chips = names
			.map(name => {
				const stateClass = name === activeDatasetName ? 'active' : '';
				const systemClass = system ? 'dataset-chip-system' : '';
				return `<button class="dataset-chip ${systemClass} ${stateClass}" type="button" data-dataset-name="${name}">${name}</button>`;
			})
			.join('');
		return `
			<section class="dataset-group">
				<p class="dataset-group-label">${title}</p>
				<div class="dataset-row">${chips}</div>
			</section>
		`;
	};

	datasetList.innerHTML = [renderGroup('Source datasets', sourceDatasets, false), renderGroup('System datasets', systemDatasets, true)].join('');

	const availableForVersions = datasetOptionsForVersions();
	for (const select of versionRowsContainer.querySelectorAll('.version-dataset')) {
		const current = select.value;
		select.innerHTML = [`<option value="">Select dataset</option>`, ...availableForVersions.map(name => `<option value="${name}">${name}</option>`)].join('');
		if (availableForVersions.includes(current)) {
			select.value = current;
		}
	}
	recomputeVersionBuilderState();
}

function updateSearchMatches() {
	const query = editorSearch.value;
	const text = datasetEditor.value;
	searchMatches = [];
	activeSearchMatchIndex = -1;
	if (!query) {
		editorSearchCount.textContent = '0 matches';
		return;
	}

	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let start = 0;
	while (start < lowerText.length) {
		const index = lowerText.indexOf(lowerQuery, start);
		if (index === -1) break;
		searchMatches.push(index);
		start = index + lowerQuery.length;
	}

	editorSearchCount.textContent = `${searchMatches.length} match(es)`;
	if (searchMatches.length) {
		activeSearchMatchIndex = 0;
		focusSearchMatch();
	}
}

// Font/spacing properties that must be mirrored so line-height & glyph width match the textarea.
// Width and box-sizing are handled separately below since the textarea's scrollbar
// shrinks its usable content width in a way computed style alone doesn't reflect.
const MIRROR_PROPS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'tabSize'];

/** Returns the pixel offset (top, height) of a caret position inside a textarea. */
function getCaretOffset(textarea, position) {
	const style = getComputedStyle(textarea);
	const mirror = document.createElement('div');
	mirror.style.position = 'absolute';
	mirror.style.visibility = 'hidden';
	mirror.style.top = '0';
	mirror.style.left = '-9999px';
	mirror.style.height = 'auto';
	mirror.style.whiteSpace = 'pre-wrap';
	mirror.style.wordWrap = 'break-word';
	mirror.style.overflowWrap = 'break-word';
	mirror.style.boxSizing = 'content-box';
	for (const prop of MIRROR_PROPS) mirror.style[prop] = style[prop];

	// Match the textarea's actual content width (clientWidth already excludes the scrollbar),
	// then subtract padding since box-sizing is content-box here.
	const paddingLeft = parseFloat(style.paddingLeft) || 0;
	const paddingRight = parseFloat(style.paddingRight) || 0;
	mirror.style.width = `${textarea.clientWidth - paddingLeft - paddingRight}px`;

	mirror.textContent = textarea.value.slice(0, position);
	const marker = document.createElement('span');
	marker.textContent = textarea.value.slice(position) || '.';
	mirror.appendChild(marker);

	document.body.appendChild(mirror);
	const top = marker.offsetTop;
	const height = marker.offsetHeight || parseInt(style.lineHeight, 10) || parseInt(style.fontSize, 10);
	document.body.removeChild(mirror);

	return { top, height };
}

/** Scrolls the textarea vertically so the given caret position is centered in view. */
function scrollTextareaToPosition(textarea, position) {
	const { top, height } = getCaretOffset(textarea, position);
	const target = top - textarea.clientHeight / 2 + height / 2;
	textarea.scrollTop = Math.max(0, Math.min(target, textarea.scrollHeight - textarea.clientHeight));
}

function focusSearchMatch(step) {
	if (!searchMatches.length) return;
	if (typeof step === 'number') {
		activeSearchMatchIndex = (activeSearchMatchIndex + step + searchMatches.length) % searchMatches.length;
	}
	const start = searchMatches[activeSearchMatchIndex];
	const queryLength = editorSearch.value.length;
	datasetEditor.focus();
	datasetEditor.setSelectionRange(start, start + queryLength);
	scrollTextareaToPosition(datasetEditor, start);
	editorSearchCount.textContent = `${activeSearchMatchIndex + 1}/${searchMatches.length}`;
}

async function loadDataset(name, notify) {
	const response = await fetch(`/api/dataset?name=${encodeURIComponent(name)}`);
	const payload = await response.json();
	if (!response.ok) {
		throw new Error(payload.error || `Failed to load dataset: ${name}`);
	}
	activeDatasetName = name;
	selectedDataset.value = name;
	const contents = payload.contents || {};
	datasetEditor.value = JSON.stringify(contents, null, 2);
	const adultState = getDatasetAdultState(contents);
	datasetIsAdult.disabled = !adultState.hasPerks;
	datasetIsAdult.indeterminate = adultState.mixed;
	datasetIsAdult.checked = adultState.isAdult;
	renderDatasetList(availableDatasets);
	updateSearchMatches();
	updateDatasetModeState();
	if (notify) {
		showToast({ message: `Loaded dataset: ${name}`, variant: 'success', timeout: 1800 });
	}
}

async function refreshStorageStatus(options = {}) {
	const { notify = false } = options;
	try {
		const response = await fetch('/api/status');
		const status = await response.json();
		const storage = status.storage || status.nyaDb;
		if (storage?.error) {
			databaseStatus.textContent = storage.error;
			renderDatasetList([]);
			updateDatasetModeState();
			if (notify) showToast({ message: storage.error, variant: 'error' });
			return;
		}
		const databases = storage?.databases || [];
		const size = storage?.size?.total?.formatted;
		databaseStatus.textContent = `Storage: ${databases.length} datasets${size ? `, ${size}` : ''}`;
		renderDatasetList(databases);
		updateDatasetModeState();
		if (notify) showToast({ message: 'Storage refreshed.', variant: 'success', timeout: 1800 });
	} catch (error) {
		databaseStatus.textContent = error.message;
		renderDatasetList([]);
		updateDatasetModeState();
		if (notify) showToast({ message: error.message || 'Unable to refresh status.', variant: 'error' });
	}
}

function appendUploadFiles(formData, files) {
	for (const entry of files) {
		formData.append('files', entry.file, entry.relativePath || entry.file.name);
	}
}

async function collectDirectoryEntries(handle, prefix) {
	const entries = [];
	for await (const [name, item] of handle.entries()) {
		if (item.kind === 'file') {
			const file = await item.getFile();
			entries.push({ file, relativePath: `${prefix}/${name}` });
			continue;
		}
		if (item.kind === 'directory') {
			const nested = await collectDirectoryEntries(item, `${prefix}/${name}`);
			entries.push(...nested);
		}
	}
	return entries;
}

async function handleChooseFolder() {
	const supportsDirectoryPicker = typeof window.showDirectoryPicker === 'function';
	if (!supportsDirectoryPicker) {
		folderInput.click();
		return;
	}

	try {
		const handle = await window.showDirectoryPicker({ mode: 'read' });
		const entries = await collectDirectoryEntries(handle, handle.name);
		const filteredEntries = entries.filter(entry => /\.(csv|md)$/i.test(entry.file.name));
		const { added } = mergeFolderEntries(filteredEntries);
		updateFileCount();
		if (!filteredEntries.length) {
			showToast({ message: 'Folder selected, but no CSV/Markdown files were found.', variant: 'info' });
			return;
		}
		showToast({ message: `Folder added: ${added} new file(s) queued.`, variant: 'success' });
	} catch (error) {
		if (error?.name === 'AbortError') return;
		showToast({ message: 'Unable to read folder. Try fallback picker.', variant: 'error' });
		folderInput.click();
	}
}

form.addEventListener('submit', async event => {
	event.preventDefault();
	await withBusy(
		convertButton,
		async () => {
			const files = selectedFiles();
			if (!files.length) {
				setRunState('Failed', 'failed');
				renderLogs([], 'Select at least one CSV or Markdown file.');
				await showModal({
					title: 'No Files Selected',
					message: 'Select at least one CSV or Markdown file before starting conversion.',
					confirmLabel: 'Got it',
					allowDismiss: true,
					showCancel: false,
				});
				return;
			}

			const formData = new FormData();
			formData.append('writeNyaDb', document.querySelector('#writeNyaDb').checked ? 'true' : 'false');
			formData.append('persistRegistry', document.querySelector('#persistRegistry').checked ? 'true' : 'false');
			appendUploadFiles(formData, files);

			setRunState('Running', 'running');
			outputs.innerHTML = '';
			renderLogs([{ level: 'info', message: 'Conversion started.' }]);
			showToast({ message: 'Conversion started.', variant: 'info', timeout: 1600 });

			try {
				const response = await fetch('/api/convert', { method: 'POST', body: formData });
				const payload = await response.json();
				if (!response.ok) throw payload;

				setRunState('Done', 'done');
				renderMetrics(payload.report);
				renderOutputs(payload);
				renderLogs(payload.logs);
				await refreshStorageStatus();
				showToast({
					message: `Conversion complete: ${(payload.report?.perkCount || 0).toLocaleString()} perks across ${(payload.report?.categoryCount || 0).toLocaleString()} categories.`,
					variant: 'success',
				});
			} catch (error) {
				setRunState('Failed', 'failed');
				renderMetrics(null);
				renderOutputs(null);
				renderLogs(error.logs, error.error || error.message || 'Conversion failed.');
				showToast({ message: error.error || error.message || 'Conversion failed.', variant: 'error' });
				await showModal({
					title: 'Conversion Failed',
					message: error.error || error.message || 'Conversion failed. Check logs for details.',
					confirmLabel: 'Close',
					allowDismiss: true,
					showCancel: false,
				});
			}
		},
		'Converting...',
	);
});

filesInput.addEventListener('change', updateFileCount);

folderInput.addEventListener('change', () => {
	if (!folderInput.files.length) {
		updateFileCount();
		return;
	}

	const fallbackEntries = [...folderInput.files]
		.filter(file => /\.(csv|md)$/i.test(file.name))
		.map(file => ({
			file,
			relativePath: file.webkitRelativePath || file.name,
		}));

	const { added } = mergeFolderEntries(fallbackEntries);
	folderInput.value = '';
	showToast({ message: `Fallback folder added: ${added} new file(s) queued.`, variant: 'info', timeout: 2200 });
	updateFileCount();
});

chooseFolder.addEventListener('click', () => withBusy(chooseFolder, handleChooseFolder, 'Loading...'));

clearFolders.addEventListener('click', async () => {
	if (!pickedFolderEntries.length) return;
	const confirmed = await showModal({
		title: 'Clear Folder Queue',
		message: 'Remove all selected folder files from the queue?',
		confirmLabel: 'Clear',
		cancelLabel: 'Keep',
		variant: 'danger',
		allowDismiss: true,
		showCancel: true,
	});
	if (confirmed) {
		clearFolderQueue();
		showToast({ message: 'Folder queue cleared.', variant: 'success', timeout: 1800 });
	}
});

for (const eventName of ['dragenter', 'dragover']) {
	dropzone.addEventListener(eventName, event => {
		event.preventDefault();
		dropzone.classList.add('dragging');
	});
}

for (const eventName of ['dragleave', 'drop']) {
	dropzone.addEventListener(eventName, event => {
		event.preventDefault();
		dropzone.classList.remove('dragging');
	});
}

clearLogs.addEventListener('click', async () => {
	const confirmed = await showModal({
		title: 'Clear Logs',
		message: 'Remove all current log lines?',
		confirmLabel: 'Clear',
		cancelLabel: 'Keep',
		variant: 'danger',
		allowDismiss: true,
		showCancel: true,
	});

	if (confirmed) {
		logs.textContent = 'Ready.';
		showToast({ message: 'Logs cleared.', variant: 'success', timeout: 1800 });
	}
});

refreshStatus.addEventListener('click', () => withBusy(refreshStatus, () => refreshStorageStatus({ notify: true })));
refreshDatasets.addEventListener('click', () => withBusy(refreshDatasets, () => refreshStorageStatus({ notify: true })));

datasetList.addEventListener('click', event => {
	const button = event.target.closest('[data-dataset-name]');
	if (!button) return;
	withBusy(button, () => loadDataset(button.dataset.datasetName, true), 'Loading').catch(error => {
		showToast({ message: error.message || 'Failed to load dataset.', variant: 'error' });
	});
});

reloadDataset.addEventListener('click', () => {
	if (!activeDatasetName) {
		showToast({ message: 'Select a dataset first.', variant: 'info', timeout: 1800 });
		return;
	}
	withBusy(reloadDataset, () => loadDataset(activeDatasetName, true), 'Reloading...').catch(error => {
		showToast({ message: error.message || 'Failed to reload dataset.', variant: 'error' });
	});
});

saveDataset.addEventListener('click', () => {
	if (!activeDatasetName) {
		showToast({ message: 'Select a dataset first.', variant: 'info', timeout: 1800 });
		return;
	}

	let parsed;
	try {
		parsed = JSON.parse(datasetEditor.value || '{}');
	} catch (error) {
		showToast({ message: `Invalid JSON: ${error.message}`, variant: 'error' });
		return;
	}

	if (!datasetIsAdult.disabled && !datasetIsAdult.indeterminate) {
		applyDatasetAdultState(parsed, datasetIsAdult.checked);
		datasetEditor.value = JSON.stringify(parsed, null, 2);
	}

	withBusy(
		saveDataset,
		async () => {
			const response = await fetch(`/api/dataset?name=${encodeURIComponent(activeDatasetName)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(parsed),
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload.error || `Failed to save dataset: ${activeDatasetName}`);
			}
			showToast({ message: `Saved dataset: ${activeDatasetName}`, variant: 'success' });
			await refreshStorageStatus();
		},
		'Saving...',
	).catch(error => {
		showToast({ message: error.message || 'Failed to save dataset.', variant: 'error' });
	});
});

editorSearch.addEventListener('input', scheduleSearchUpdate);
editorSearchNext.addEventListener('click', () => {
	flushSearchUpdate();
	focusSearchMatch(1);
});
editorSearchPrev.addEventListener('click', () => {
	flushSearchUpdate();
	focusSearchMatch(-1);
});
datasetEditor.addEventListener('input', scheduleSearchUpdate);

clearDatasetSelection.addEventListener('click', () => {
	if (!activeDatasetName) return;
	clearSelectedDataset(true);
});

datasetIsAdult.addEventListener('change', () => {
	datasetIsAdult.indeterminate = false;
});

addVersionRow.addEventListener('click', () => {
	createVersionRow({ database: activeDatasetName || '' });
	recomputeVersionBuilderState();
});

saveCategoryVersions.addEventListener('click', () => {
	const rows = collectVersionRows();
	if (!rows.length) {
		showToast({ message: 'Add at least one version row.', variant: 'error' });
		return;
	}

	const categoryIds = [...new Set(rows.map(row => suggestVersionFromDatabase(row.database).categoryId))];
	const categoryInfo = suggestVersionFromDatabase(rows[0].database);
	const defaultVersion = categoryDefaultVersionSelect.value || rows[0].versionId;
	if (categoryIds.length !== 1) {
		showToast({ message: `Mixed sources detected. Saving under category: ${categoryInfo.categoryId}`, variant: 'info', timeout: 2600 });
	}

	withBusy(
		saveCategoryVersions,
		async () => {
			const response = await fetch('/api/category-version', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					categoryId: categoryInfo.categoryId,
					displayName: categoryInfo.categoryDisplayName,
					defaultVersion,
					versions: rows.map((row, index) => ({
						database: row.database,
						id: row.versionId,
						order: index,
					})),
				}),
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload.error || 'Failed to save category versions');
			}
			showToast({ message: `Saved versions for ${categoryInfo.categoryDisplayName}.`, variant: 'success' });
			await refreshStorageStatus();
			if (availableDatasets.includes('categories')) {
				await loadDataset('categories');
			}
		},
		'Saving...',
	).catch(error => {
		showToast({ message: error.message || 'Failed to save category versions.', variant: 'error' });
	});
});

[tabUpload, tabDatasets].forEach(button => {
	button.addEventListener('click', () => {
		switchTab(button.dataset.tab);
	});
});

updateFileCount();
renderMetrics(null);
switchTab('upload');
createVersionRow();
recomputeVersionBuilderState();
updateDatasetModeState();
refreshStorageStatus();

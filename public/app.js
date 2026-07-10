const form = document.querySelector('#convertForm');
const filesInput = document.querySelector('#files');
const folderInput = document.querySelector('#folderFiles');
const fileCount = document.querySelector('#fileCount');
const convertButton = document.querySelector('#convertButton');
const runState = document.querySelector('#runState');
const metrics = document.querySelector('#metrics');
const outputs = document.querySelector('#outputs');
const logs = document.querySelector('#logs');
const clearLogs = document.querySelector('#clearLogs');
const refreshStatus = document.querySelector('#refreshStatus');
const databaseStatus = document.querySelector('#databaseStatus');
const dropzone = document.querySelector('#dropzone');

function selectedFiles() {
	return [...filesInput.files, ...folderInput.files];
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
		['NyaDB', report?.nyaDbDatabaseCount || 0],
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

async function refreshNyaDbStatus() {
	try {
		const response = await fetch('/api/status');
		const status = await response.json();
		if (status.nyaDb?.error) {
			databaseStatus.textContent = status.nyaDb.error;
			return;
		}
		const count = status.nyaDb?.databases?.length || 0;
		const size = status.nyaDb?.size?.total?.formatted;
		databaseStatus.textContent = `NyaDB: ${count} databases${size ? `, ${size}` : ''}`;
	} catch (error) {
		databaseStatus.textContent = error.message;
	}
}

function appendUploadFiles(formData, files) {
	for (const file of files) {
		formData.append('files', file, file.webkitRelativePath || file.name);
	}
}

form.addEventListener('submit', async event => {
	event.preventDefault();
	const files = selectedFiles();
	if (!files.length) {
		setRunState('Failed', 'failed');
		renderLogs([], 'Select at least one CSV or Markdown file.');
		return;
	}

	const formData = new FormData();
	formData.append('category', document.querySelector('#category').value || 'uploaded');
	formData.append('writeNyaDb', document.querySelector('#writeNyaDb').checked ? 'true' : 'false');
	formData.append('persistRegistry', document.querySelector('#persistRegistry').checked ? 'true' : 'false');
	appendUploadFiles(formData, files);

	setRunState('Running', 'running');
	convertButton.disabled = true;
	outputs.innerHTML = '';
	renderLogs([{ level: 'info', message: 'Conversion started.' }]);

	try {
		const response = await fetch('/api/convert', {
			method: 'POST',
			body: formData,
		});
		const payload = await response.json();
		if (!response.ok) throw payload;

		setRunState('Done', 'done');
		renderMetrics(payload.report);
		renderOutputs(payload);
		renderLogs(payload.logs);
		refreshNyaDbStatus();
	} catch (error) {
		setRunState('Failed', 'failed');
		renderMetrics(null);
		renderOutputs(null);
		renderLogs(error.logs, error.error || error.message || 'Conversion failed.');
	} finally {
		convertButton.disabled = false;
	}
});

for (const input of [filesInput, folderInput]) {
	input.addEventListener('change', updateFileCount);
}

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

clearLogs.addEventListener('click', () => {
	logs.textContent = 'Ready.';
});

refreshStatus.addEventListener('click', refreshNyaDbStatus);

updateFileCount();
renderMetrics(null);
refreshNyaDbStatus();

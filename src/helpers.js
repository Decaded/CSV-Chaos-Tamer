const { shared } = require('./config/settings');

const MACHINE_ID_RE = /^[a-z0-9_-]+$/;

const slugify = shared.slugify;

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

function deriveSourceEdition(folderName) {
	const fileKey = requireMachineId(folderName);
	const versionMatch = fileKey.match(/^(.+)_v(\d+)$/);
	const sourceId = versionMatch ? versionMatch[1] : fileKey;
	const editionVersion = versionMatch ? `v${versionMatch[2]}` : 'default';
	const sourceDisplayName = displayNameFromId(sourceId);
	const editionDisplayName = editionVersion === 'default' ? sourceDisplayName : `${sourceDisplayName} ${editionVersion.toUpperCase()}`;

	return {
		sourceId,
		sourceDisplayName,
		editionVersion,
		editionDisplayName,
		fileKey,
	};
}

function deriveSplitEdition(splitName) {
	const fileKey = requireMachineId(splitName);
	const sourceDisplayName = displayNameFromId(fileKey);
	return {
		sourceId: fileKey,
		sourceDisplayName,
		editionVersion: 'default',
		editionDisplayName: sourceDisplayName,
		fileKey,
	};
}

function originNameForRow(row, fallback) {
	return String(row.origin || row.__origin || fallback || 'Unknown Origin').trim();
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

function isAdultRow(row, fileKey) {
	if (typeof row.isAdult === 'boolean') return row.isAdult;
	return /\b(lewd|porn|bordello|debauchery)\b/i.test([row.chapter, row.origin, row.__origin].filter(Boolean).join(' '));
}

function logicalIdentityForRow(row, fileKey) {
	const originFile = requireMachineId(row.__origin || 'origin');
	const rowId = Number.isFinite(row.id) && row.id > 0 ? `id_${row.id}` : `line_${row.__line || 0}`;
	return `${fileKey}/${originFile}/${rowId}`;
}

function sortObjectByKeys(obj) {
	return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

module.exports = {
	MACHINE_ID_RE,
	requireMachineId,
	displayNameFromId,
	deriveSourceEdition,
	deriveSplitEdition,
	originNameForRow,
	normalizeCost,
	normalizeTags,
	isAdultRow,
	logicalIdentityForRow,
	sortObjectByKeys,
};
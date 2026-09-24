const fs = require('fs');
const path = require('path');

const KEYWORD_FILTER_PATH = path.join(__dirname, '..', 'config', 'keyword-filter.json');

function loadKeywords() {
	try {
		const raw = fs.readFileSync(KEYWORD_FILTER_PATH, 'utf8');
		const parsed = JSON.parse(raw);
		return (parsed.keywords || []).map(k => String(k).toLowerCase()).filter(Boolean);
	} catch (err) {
		console.warn('Could not load keyword-filter.json, mature keyword detection disabled.', err.message);
		return [];
	}
}

/**
 * Sets isMature = true for any source whose displayName or description
 * contains any keyword from keyword-filter.json (case‑insensitive substring).
 * @param {object[]} sources - Array of source metadata objects, mutated in place.
 */
function updateSourceMatureFlags(sources) {
	const keywords = loadKeywords();
	if (!keywords.length) return;
	for (const source of sources) {
		const text = [source.displayName, source.description].filter(Boolean).join(' ').toLowerCase();
		const hasKeyword = keywords.some(keyword => text.includes(keyword));
		if (hasKeyword) source.isMature = true;
		// If already true from perk detection, we keep it true.
	}
}

module.exports = { updateSourceMatureFlags };
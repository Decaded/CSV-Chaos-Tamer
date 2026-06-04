const fs = require('fs');
const path = require('path');
const { md: mdConfig } = require('./config');

/** Regex that matches the start of a numbered entry (e.g. "1\." or "132.") */
const NUMBERED_RE = /^(\d+)\\?\.\s+/;

/** Regex for a category marker line: a short title ending with colon and optional whitespace */
const CATEGORY_RE = /^([A-Za-zÀ-ÿ][\w\s''-]{0,40}):\s*$/;

/**
 * Detect whether `line` is a chapter heading.
 * A chapter heading is a short, non-blank, non-numbered, title-like line
 * whose next non-blank line is a numbered entry.
 */
function isChapterHeading(lines, idx) {
	const line = lines[idx].trim();
	if (!line) return false;
	if (NUMBERED_RE.test(line)) return false;
	if (CATEGORY_RE.test(line)) return false;
	if (line.length > 80) return false;

	// Reject description-like lines: ends with sentence punctuation
	if (/[.!?][\s\\]*$/.test(line)) return false;
	// Reject lines starting with lowercase (description continuations)
	if (/^[a-z]/.test(line)) return false;

	// Look ahead: the next non-blank line must be a numbered entry
	for (let j = idx + 1; j < lines.length; j++) {
		const next = lines[j].trim();
		if (!next) continue; // skip blanks
		return NUMBERED_RE.test(next);
	}
	return false;
}

/**
 * Extract cost and name from the "rest of line" after the item number.
 * Handles all observed formats:
 *   (Free) Name – Desc          →  cost="Free",  name="Name"
 *   (-300CP) Name – Desc        →  cost="-300CP", name="Name"
 *   (200) Name- Desc            →  cost="200",    name="Name"
 *   Die Ewigkeit- Free          →  cost="Free",   name="Die Ewigkeit"
 *   Ahnenerbe – 500             →  cost="500",    name="Ahnenerbe"
 *   *Sea Legs 100               →  cost="100",    name="Sea Legs"
 *   Demon [200]                 →  cost="200",    name="Demon"
 */
function parseEntry(rawRest) {
	// Clean markdown escape sequences: \* → *, \[ → [, \] → ], \! → !
	const rest = rawRest.replace(/\\([*[\]!])/g, '$1').replace(/\u00AD/g, '-');
	let name,
		cost,
		descStart = '';

	// Format: (Type) Name (-4000): where the leading parens are metadata, not cost
	const leadingTypeTrailingCost = rest.match(/^\((?!\s*(?:Free|-?\d|[^)]*(?:CP|BP|KP)))([^)]+)\)\s*(.+?)\s*\((-?\d+(?:\s*(?:CP|BP|KP))?)\)\s*:?\s*$/i);
	if (leadingTypeTrailingCost) {
		name = leadingTypeTrailingCost[2].replace(/^\*+/, '').trim();
		cost = leadingTypeTrailingCost[3].trim();
		return { name, cost, descStart: '' };
	}

	// Format: [COST] Name: Description or [COST] Name - Description or [COST] Name (desc on next line)
	// Handle multiple brackets by preferring ones with CP/BP/KP
	const bracketCostFirst = rest.match(/^\[([^\]]+)\][\s​\u200B]+(.+)$/s);
	if (bracketCostFirst) {
		let cost = bracketCostFirst[1].trim();
		let afterCost = bracketCostFirst[2];

		// Check if there's another bracket with CP/BP/KP - prefer that one
		const secondBracket = afterCost.match(/^\[([^\]]*(?:CP|BP|KP|Free)[^\]]*)\][\s​\u200B]*(.*)$/is);
		if (secondBracket && /(?:CP|BP|KP|Free)/i.test(secondBracket[1])) {
			// Second bracket has a proper cost marker, use it instead
			cost = secondBracket[1].trim();
			afterCost = secondBracket[2];
		}

		// Check if there's a separator for inline description
		const withSep = afterCost.match(/^(.+?)(?::\s+|\s+-\s+)(.+)$/s);
		if (withSep) {
			name = withSep[1].replace(/^\*+/, '').trim();
			descStart = withSep[2];
		} else {
			name = afterCost.replace(/^\*+/, '').trim();
			descStart = '';
		}
		return { name, cost, descStart };
	}

	// Format: "Name" [COST] Description (quoted name with bracket cost and zero-width spaces)
	const quotedNameBracket = rest.match(/^[""](.+?)[""][\s​\u200B]*\[([^\]]+)\][\s​\u200B]+(.+)$/s);
	if (quotedNameBracket) {
		name = quotedNameBracket[1].trim();
		cost = quotedNameBracket[2].trim();
		descStart = quotedNameBracket[3];
		return { name, cost, descStart };
	}

	// Format: (COST) Name ...
	const parenCost = rest.match(/^\(([^)]+)\)\s*/);
	if (parenCost) {
		cost = parenCost[1].trim();
		const after = rest.slice(parenCost[0].length);

		// Try to split on various separators: em dash (–), escaped dash (\-), dash with space, or period followed by a capitalized sentence
		const parts = after.match(/^(.+?)(?:\s*[–]\s+|\s+\\-\s+|\s+-\s+|-\s+|\.\s+(?=[A-Z]))(.*)$/s);
		if (parts) {
			name = parts[1].replace(/\.$/, '').trim(); // Remove trailing period
			descStart = parts[2].trim();
		} else {
			name = after.trim();
		}
		return { name, cost, descStart };
	}

	// Format: Free/200/400 - Name, 300cp - Name, 100CP -- Name, or 200CP: Name
	// Handles multi-costs like "Free/200/400" and single costs
	const costDashName = rest.match(/^((?:Free|\d+)(?:\/(?:Free|\d+))*(?:\s*[Cc][Pp]|\s*[Bb][Pp]|\s*[Kk][Pp])?)\s*(?::|--+|[-–])\s*(.+)$/s);
	if (costDashName) {
		cost = costDashName[1].trim();
		const nameAndDesc = costDashName[2];

		// Check if there's another dash separator for description (need at least a few words before the dash)
		const nameSplit = nameAndDesc.match(/^(.{3,}?)(?:\s+(?:--+|[-–])\s+|\.\s+(?=[A-Z])|:\s+)(.+)$/s);
		if (nameSplit) {
			name = nameSplit[1].replace(/^\*+/, '').trim();
			descStart = nameSplit[2];
		} else {
			name = nameAndDesc.replace(/^\*+/, '').trim();
		}
		return { name, cost, descStart };
	}

	// Format: Name - 600 - Description
	const nameDashCostDashDesc = rest.match(/^(.+?)\s*[-–]\s+(-?\d+(?:\s*(?:CP|BP|KP))?|Free)\s+[-–]\s+(.+)$/is);
	if (nameDashCostDashDesc) {
		name = nameDashCostDashDesc[1].replace(/^\*+/, '').trim();
		cost = nameDashCostDashDesc[2].trim();
		descStart = nameDashCostDashDesc[3];
		return { name, cost, descStart };
	}

	// Format: Name: (COST): Description - cost in middle with colons
	const nameColonCost = rest.match(/^(.+?):\s*\(([^)]*(?:CP|BP|KP|Free)[^)]*)\)\s*:\s*(.+)$/is);
	if (nameColonCost) {
		name = nameColonCost[1].replace(/^\*+/, '').trim();
		cost = nameColonCost[2].replace(/,.*$/, '').trim();
		descStart = nameColonCost[3];
		return { name, cost, descStart };
	}

	// Format: Name (300, requirement text): Description or Name (300): Description
	const numericParenCostColon = rest.match(/^(.+?)\s*\((-?\d+)(?:\s*,[^)]*)?\)\s*[-–:\s]*(.+)$/is);
	if (numericParenCostColon) {
		name = numericParenCostColon[1].replace(/^\*+/, '').trim();
		cost = numericParenCostColon[2].trim();
		descStart = numericParenCostColon[3];
		return { name, cost, descStart };
	}

	// Format: Name (COST): Description or Name (Free)- Description
	// Handles: CP, BP, KP, Free with optional dash/colon separator
	const endParenCostColon = rest.match(/^(.+?)\s*\(([^)]*(?:CP|BP|KP|Free)[^)]*)\)[-–:\s]*(.+)$/is);
	if (endParenCostColon) {
		name = endParenCostColon[1].replace(/^\*+/, '').trim();
		// Clean up the cost: remove commas and extra text after comma
		cost = endParenCostColon[2].replace(/,.*$/, '').trim();
		descStart = endParenCostColon[3];
		return { name, cost, descStart };
	}

	// Format: Name (COST) - cost at the end in parentheses (no inline description)
	// Handles: CP, BP, KP, Free
	const endParenCost = rest.match(/^(.+?)\s*\(([^)]*(?:CP|BP|KP|Free)[^)]*)\)\s*$/i);
	if (endParenCost) {
		name = endParenCost[1].replace(/^\*+/, '').trim();
		cost = endParenCost[2].replace(/,.*$/, '').trim();
		return { name, cost, descStart: '' };
	}

	// Format: Name [600 KP] [Requires Something] (cost bracket plus metadata brackets)
	const costBracketThenMetadata = rest.match(/^(.+?)\s*\[([^\]]*(?:CP|BP|KP|Free|SPECIAL)[^\]]*)\](?:\s*\[[^\]]+\])+\s*$/i);
	if (costBracketThenMetadata) {
		name = costBracketThenMetadata[1].replace(/^\*+/, '').trim();
		cost = costBracketThenMetadata[2].trim();
		return { name, cost, descStart: '' };
	}

	// Format: Name [COST]: Description
	const bracketCostColonDesc = rest.match(/^(.+?)\s*\[([^\]]+)\]\s*:\s*(.+)$/s);
	if (bracketCostColonDesc) {
		name = bracketCostColonDesc[1].replace(/^\*+/, '').trim();
		cost = bracketCostColonDesc[2].trim();
		descStart = bracketCostColonDesc[3];
		return { name, cost, descStart };
	}

	// Format: Name [COST] or Name [COST]: or Name [COST] - with optional zero-width spaces
	const bracketCost = rest.match(/^(.+?)\s*\[([^\]]+)\]\s*[:​\u200B\s]*$/);
	if (bracketCost) {
		name = bracketCost[1].replace(/^\*+/, '').trim();
		cost = bracketCost[2].trim();
		return { name, cost, descStart: '' };
	}

	// Format: Name [COST]: Description or Name [COST] - Description (with separator and zero-width spaces)
	const bracketCostDesc = rest.match(/^(.+?)\s*\[([^\]]+)\]\s*[:​\u200B\s]*[-–]\s*(.+)$/s);
	if (bracketCostDesc) {
		name = bracketCostDesc[1].replace(/^\*+/, '').trim();
		cost = bracketCostDesc[2].trim();
		descStart = bracketCostDesc[3];
		return { name, cost, descStart };
	}

	// Format: Name [COST] Description
	const bracketCostSpaceDesc = rest.match(/^(.+?)\s*\[([^\]]+)\][\s\u200B]+(.+)$/s);
	if (bracketCostSpaceDesc) {
		name = bracketCostSpaceDesc[1].replace(/^\*+/, '').trim();
		cost = bracketCostSpaceDesc[2].trim();
		descStart = bracketCostSpaceDesc[3];
		return { name, cost, descStart };
	}

	// Format: Name – COST  (em dash with numeric/free cost after)
	const emDashCost = rest.match(/^(.+?)\s*[–]\s*(\d+(?:\s*CP)?|Free)\s*$/i);
	if (emDashCost) {
		name = emDashCost[1].replace(/^\*+/, '').trim();
		cost = emDashCost[2].trim();
		return { name, cost, descStart: '' };
	}

	// Format: Name- COST  (regular dash, cost is numeric or "Free" at end)
	const dashCost = rest.match(/^(.+?)\s*-\s*(\d+(?:\s*CP)?|Free)\s*$/i);
	if (dashCost) {
		name = dashCost[1].replace(/^\*+/, '').trim();
		cost = dashCost[2].trim();
		return { name, cost, descStart: '' };
	}

	// Format: *Name COST  (asterisk prefix, cost is the last token)
	const starNum = rest.match(/^\*(.+?)\s+(\d+(?:\s*CP)?|Free)\s*$/i);
	if (starNum) {
		name = starNum[1].trim();
		cost = starNum[2].trim();
		return { name, cost, descStart: '' };
	}

	// Format: Name – Description (em dash, no obvious cost → Free)
	const emDashDesc = rest.match(/^(.+?)\s+[–]\s+(.+)$/s);
	if (emDashDesc) {
		name = emDashDesc[1].replace(/^\*+/, '').trim();
		cost = 'Free';
		descStart = emDashDesc[2];
		return { name, cost, descStart };
	}

	// Format: Just cost on the line (100 CP:) - name will be on next line
	const justCost = rest.match(/^(\d+\s*(?:CP|BP|KP|cp|bp|kp)):\s*$/i);
	if (justCost) {
		// Malformed entry - we'll use the cost and let description become the name
		name = '[Cost only - check source]';
		cost = justCost[1].trim();
		return { name, cost, descStart: '' };
	}

	// Fallback
	name = rest.replace(/^\*+/, '').trim();
	cost = 'Free';
	return { name, cost, descStart: '' };
}

/**
 * Parse a markdown file and return rows matching CSV output format.
 * @param {string} filePath
 * @returns {Promise<{rows: object[], source: string}>}
 */
async function parseMarkdown(filePath) {
	const transforms = mdConfig.transforms;
	const content = await fs.promises.readFile(filePath, 'utf8');
	const filename = path.basename(filePath, '.md');

	// Pre-process: split lines where a numbered entry starts mid-line (DOCX wrapping artifact)
	const rawLines = content.split('\n');
	const lines = [];
	for (const line of rawLines) {
		// Remove {metadata} blocks like {exalted-solars .unnumbered}
		let cleaned = line.replace(/\{[^}]+\}/g, '');

		// Unescape markdown: \( → (, \) → ), \[ → [, \] → ], \' → '
		cleaned = cleaned.replace(/\\([()[\]'"])/g, '$1');

		// Remove blockquote markers but keep the content
		cleaned = cleaned.replace(/^>\s*/, '');

		const midMatch = cleaned.match(/^(.+\S)\s{2,}(\d+\\?\.\s+.*)$/);
		if (midMatch) {
			lines.push(midMatch[1]);
			lines.push(midMatch[2]);
		} else {
			lines.push(cleaned);
		}
	}

	let currentCategory = '';
	let currentSource = '';
	const rows = [];

	// We'll do a single pass collecting entries.
	// First, identify all numbered-entry start lines so we know boundaries.
	const entryStarts = []; // { lineIdx, id, rest }
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(NUMBERED_RE);
		if (m) {
			entryStarts.push({ lineIdx: i, id: m[1], rest: lines[i].slice(m[0].length) });
		}
	}

	// Now walk the file, tracking category/chapter and building entries.
	let entryIdx = 0; // pointer into entryStarts

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		// Category marker?
		const catMatch = trimmed.match(CATEGORY_RE);
		if (catMatch) {
			currentCategory = catMatch[1].trim();
			continue;
		}

		// Chapter heading? (This becomes the "source" field)
		if (isChapterHeading(lines, i)) {
			currentSource = trimmed;
			continue;
		}

		// Numbered entry?
		if (entryIdx < entryStarts.length && i === entryStarts[entryIdx].lineIdx) {
			const { id, rest } = entryStarts[entryIdx];
			const nextEntryLine = entryIdx + 1 < entryStarts.length ? entryStarts[entryIdx + 1].lineIdx : lines.length;
			entryIdx++;

			let { name, cost, descStart } = parseEntry(rest);

			// Collect description: everything from line i+1 up to (but not including) the next entry,
			// UNLESS there's a chapter heading in between – stop before that.
			let descLines = descStart ? [descStart] : [];
			for (let j = i + 1; j < nextEntryLine; j++) {
				// If this line is a chapter heading, stop collecting – it belongs to the next section
				if (isChapterHeading(lines, j)) break;
				// Category markers also stop collection
				if (CATEGORY_RE.test(lines[j].trim())) break;
				descLines.push(lines[j]);
			}

			const nextLineCostIndex = descLines.findIndex(line => line.trim());
			const nextLineCost =
				nextLineCostIndex >= 0
					? descLines[nextLineCostIndex].trim().match(/^(-?\d+(?:\s*(?:CP|BP|KP))?|Free|Variable\s+CP)\s*:?\s*$/i)
					: null;
			const parsedCost = transforms.cost(cost);
			const costLooksLikeMetadata = typeof parsedCost !== 'number' && !/free|\d/i.test(String(parsedCost));
			if (nextLineCost && (cost === 'Free' || costLooksLikeMetadata)) {
				cost = nextLineCost[1];
				descLines.splice(0, nextLineCostIndex + 1);
			}

			const description = transforms.description(descLines.join('\n'));

			if (!name) continue;

			// Post-process: If name is just a cost, placeholder, or empty/very short, extract real name from description
			const isProblematicName =
				/^\d+\s*(?:CP|BP|KP)?:?\s*$/i.test(name) ||
				name === '[Cost only - check source]' ||
				name.length < 3 || // Very short or empty
				/^\[.*\]$/.test(name); // Just brackets

			if (isProblematicName) {
				// Find first non-empty line in description
				let realNameLine = null;
				let realNameIndex = -1;
				for (let k = 0; k < descLines.length; k++) {
					const trimmed = descLines[k].trim();
					if (trimmed && trimmed.length > 3) {
						// Must be substantial
						realNameLine = trimmed;
						realNameIndex = k;
						break;
					}
				}

				if (realNameLine) {
					const titleDescription = realNameLine.match(/^([^:]{3,80}):\s+(.+)$/s);
					if (titleDescription) {
						descLines.splice(0, realNameIndex + 1, titleDescription[2]);
						const newDescription = transforms.description(descLines.join('\n'));
						const costFromName = name.match(/\d+/)?.[0];

						const row = {
							id: transforms.id(id),
							cost: transforms.cost(costFromName || cost),
							name: transforms.name(titleDescription[1].trim()),
							description: newDescription,
							chapter: currentCategory || filename,
							source: currentSource || filename,
						};
						rows.push(row);
						continue;
					}

					const costOnlyName = /^\d+\s*(?:CP|BP|KP)?:?\s*$/i.test(transforms.name(name));
					if (costOnlyName && currentSource && currentSource !== filename) {
						const row = {
							id: transforms.id(id),
							cost: transforms.cost(name),
							name: transforms.name(currentSource),
							description,
							chapter: currentCategory || filename,
							source: currentSource || filename,
						};
						rows.push(row);
						continue;
					}

					// Check if this line looks like a name (short, first line, or title-case)
					const looksLikeName = realNameLine.length < 100 || realNameIndex === 0;
					if (looksLikeName) {
						// Remove the name line and any preceding blank lines from description
						descLines.splice(0, realNameIndex + 1);
						const newDescription = transforms.description(descLines.join('\n'));

						// If original name had a cost number in it, use that; otherwise use the parsed cost
						const costFromName = name.match(/\d+/)?.[0];

						const row = {
							id: transforms.id(id),
							cost: transforms.cost(costFromName || cost),
							name: transforms.name(realNameLine.replace(/\[.*?\]/, '').trim()), // Remove any bracket costs from name
							description: newDescription,
							chapter: currentCategory || filename,
							source: currentSource || filename,
						};
						rows.push(row);
						continue;
					}
				}
			}

			const row = {
				id: transforms.id(id),
				cost: transforms.cost(cost),
				name: transforms.name(name),
				description,
				chapter: currentCategory || filename,
				source: currentSource || filename,
			};

			if (
				rows.length &&
				row.cost === 0 &&
				!row.description &&
				row.name.length > 100 &&
				/[.!?][\s\\]*$/.test(row.name)
			) {
				const previous = rows[rows.length - 1];
				previous.description = transforms.description([previous.description, row.name].filter(Boolean).join('\n'));
				continue;
			}

			rows.push(row);
			// Skip past the lines we consumed (the for loop will increment i)
			continue;
		}
	}

	return { rows, source: currentCategory || filename };
}

module.exports = { parseMarkdown, parseEntry, isChapterHeading };

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_URL = 'https://github.com/Decaded/CSV-Chaos-Tamer';
const ISSUES_URL = `${REPO_URL}/issues`;
const BUG_TEMPLATE_FILE = 'bug_report.md';
const PROJECT_ROOT = path.join(__dirname, '..');

const MAX_ISSUES = 25;
const MAX_LOG_LINES = 30;

const ERROR_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function shortenErrorIds(error) {
	return error.replace(ERROR_UUID_RE, match => `${match.slice(0, 8)}…`);
}

function collectVersion() {
	try {
		return require('../package.json').version;
	} catch {
		return 'unknown';
	}
}

function collectCommit() {
	try {
		return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PROJECT_ROOT }).toString().trim();
	} catch {
		return null;
	}
}

/**
 * Extracts "folder/file → 0 rows" lines from build log entries. These are files the
 * parser read but understood zero rows from; they are the number one cause of a source
 * silently missing from the output.
 * @param {Array<{level?: string, message: string}>} logs
 * @returns {string[]} Paths of files that produced no rows
 */
function detectZeroRowFiles(logs) {
	const files = [];
	for (const entry of logs || []) {
		const match = /^(.*?)\s+→\s+0 rows/i.exec(String(entry?.message || ''));
		if (match) files.push(match[1].trim());
	}
	return [...new Set(files)];
}

const validateSourceMetadataConfigDocs = 'docs/SOURCE_METADATA.md';

/**
 * Returns true if the folder for a source id exists under sourcesRoot, false if the path
 * exists but is not a directory, and null when sourcesRoot is unknown/absent.
 */
function folderExistsForSource(sourceId, sourcesRoot) {
	if (!sourcesRoot) return null;
	try {
		return fs.statSync(path.join(sourcesRoot, sourceId)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Builds human, non-healing guidance for a build failure. This never edits files itself;
 * it only points the user at the likely cause and the exact place to fix it.
 * @param {{ errors: string[], zeroRowFiles: string[], sourcesRoot?: string|null }} state
 * @returns {string[]} Bullet hints, each ending with a period
 */
function selfHelpSuggestions({ errors = [], zeroRowFiles = [], sourcesRoot = null }) {
	const hints = [];

	const knownNameHeaders = 'Name, Item, Perk, Perk Name, Perk/Item, or the first column when the sheet has no name header';

	if (zeroRowFiles.length) {
		hints.push(
			`These files parsed to 0 rows and were skipped (no perks came from them): ${zeroRowFiles.join(', ')}. ` +
				`Open each one and check the first line: the perk name column should use a recognized header (${knownNameHeaders}) and the text column should be Description or Effect. ` +
				`Rows without a name and a description are dropped on purpose — see ${validateSourceMetadataConfigDocs}.`,
		);
	}

	for (const error of errors) {
		let match;
		if ((match = /^source-metadata\.config\.json has an entry for unknown source ([a-z0-9_-]+)$/.exec(error))) {
			const id = match[1];
			const folderExists = folderExistsForSource(id, sourcesRoot);
			if (folderExists) {
				hints.push(
					`The config lists source "${id}" and the folder sources/${id}/ exists, but the build produced no source from it — every file in it either parsed to 0 rows or failed to parse. ` +
						`Open the files and check the first line: the perk name column should use a recognized header (${knownNameHeaders}) and the text column should be Description or Effect; rows without a name and a description are dropped. See ${validateSourceMetadataConfigDocs}.`,
				);
			} else {
				hints.push(
					`The config file lists source "${id}" but there is no folder sources/${id}/ — the source was likely renamed or deleted. ` +
						`Either restore the folder (keeping the name identical to the id) or remove the config entry via the web panel or source-metadata.config.json.`,
				);
			}
		} else if ((match = /^Source ([a-z0-9_-]+) is missing a source-metadata\.config\.json entry$/.exec(error))) {
			hints.push(
				`The build generated source "${match[1]}" but it has no entry in src/config/source-metadata.config.json. ` +
					`Add one (with a description and an editions map of per-edition links) — either via the web panel's "Add source" button or by editing the file directly. See ${validateSourceMetadataConfigDocs}.`,
			);
		} else if ((match = /^source-metadata\.config\.json entry for ([a-z0-9_-]+) is missing a description$/.exec(error))) {
			hints.push(`Fill in a real description for source "${match[1]}" in source-metadata.config.json (or the web panel).`);
		} else if ((match = /^source-metadata\.config\.json entry for ([a-z0-9_-]+) has an invalid name$/.exec(error))) {
			hints.push(`The optional "name" for source "${match[1]}" must be a non-empty string — clear it if you do not want a custom display name.`);
		} else if ((match = /^source-metadata\.config\.json entry for ([a-z0-9_-]+) must not carry a top-level sourceUrl/.exec(error))) {
			hints.push(`Source "${match[1]}" uses the old top-level sourceUrl field — move links into each edition (version → { fileKey, sourceUrl }) in source-metadata.config.json.`);
		} else if ((match = /^source-metadata\.config\.json entry for ([a-z0-9_-]+) must not carry top-level altSourceUrl/.exec(error))) {
			hints.push(`Source "${match[1]}" uses top-level altSourceUrl/altSourceLabel — move those links onto the edition they belong to.`);
		} else if ((match = /^source-metadata\.config\.json entry for ([a-z0-9_-]+) must not use the legacy editionUrls field$/.exec(error))) {
			hints.push(`Source "${match[1]}" uses the removed editionUrls field — fold those links into its editions map as per-edition sourceUrl values.`);
		} else if ((match = /^source-metadata\.config\.json entry for ([a-z0-9_-]+) is missing an editions map$/.exec(error))) {
			hints.push(`Source "${match[1]}" needs an editions map — every entry must declare its editions as version → { fileKey, sourceUrl }.`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) has an empty editions map$/.exec(error))) {
			hints.push(`Source "${match[1]}" declares an empty editions map — add at least one edition with a fileKey and sourceUrl.`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) is missing a fileKey for edition (\S+)$/.exec(error))) {
			hints.push(`Source "${match[1]}" is missing a fileKey for edition "${match[2]}" — every edition maps version → { fileKey, sourceUrl, ... }.`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) uses a bare fileKey for edition (\S+)/.exec(error))) {
			hints.push(`Source "${match[1]}" lists edition "${match[2]}" as a bare fileKey — editions must be objects with a sourceUrl.`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) maps edition (\S+) to (\S+) but the generated source does not$/.exec(error))) {
			hints.push(`Source "${match[1]}" maps edition "${match[2]}" to "${match[3]}", but that file is not grouped under it. Fix the fileKey/version or the source folder.`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) has an empty sourceUrl for edition (\S+)$/.exec(error))) {
			hints.push(`Source "${match[1]}" has an empty sourceUrl for edition "${match[2]}" — fill in the link or delete that edition row.`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) has an invalid edition version (\S+)$/.exec(error))) {
			hints.push(`Edition version "${match[2]}" for source "${match[1]}" must be machine-id-safe (lowercase letters, numbers, dashes, underscores).`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) has a defaultVersion that is not an editions key$/.exec(error))) {
			hints.push(`The defaultVersion for source "${match[1]}" must be one of its declared edition versions.`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) must include a "default" edition or set a defaultVersion$/.exec(error))) {
			hints.push(`Source "${match[1]}" must pick a default edition — add a "default" version entry or set defaultVersion explicitly.`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) must set altSourceUrl and altSourceLabel together for edition (\S+)$/.exec(error))) {
			hints.push(`For source "${match[1]}", edition "${match[2]}" needs altSourceUrl and altSourceLabel both set, or both removed.`);
		} else if ((match = /^Edition (.+?) must set altSourceUrl and altSourceLabel together$/.exec(error))) {
			hints.push(`Edition "${match[1]}" needs altSourceUrl and altSourceLabel both set, or both removed.`);
		} else if ((match = /^source-metadata\.config\.json entry for (.+?) does not declare edition (\S+)$/.exec(error))) {
			hints.push(`Source "${match[1]}" publishes edition "${match[2]}" but its editions map does not declare it — add the entry.`);
		}
	}

	if (!hints.length) {
		hints.push(
			`Most failures are one of two things: (1) a CSV/Markdown file the parser does not understand (check the console for files reporting 0 rows, then look at their first line), or (2) a manual entry missing from source-metadata.config.json. ` +
				`Work through the validation list; see ${validateSourceMetadataConfigDocs} for the data contract.`,
		);
	}

	return hints;
}

function formatBugBody({ summary, issues, errorCount, selfHelp, zeroRowFiles, env, logs }) {
	const bullet = items => (items.length ? items.map(item => `- ${item}`).join('\n') : '- (none)');
	const logText = logs.length ? logs.map(line => line.message).join('\n').slice(0, 4000) : '(no console captured)';
	return [
		'## What happened',
		'',
		summary,
		'',
		'## Self-service checklist',
		'',
		bullet(selfHelp),
		'',
		'## Diagnostics',
		'',
		`- **App:** csv-chaos-tamer v${env.version}`,
		`- **Mode:** ${env.mode}`,
		`- **Write mode:** ${env.writeNyaDb ? 'write (NyaDB will be updated)' : 'dry run (NyaDB untouched)'}`,
		`- **Node:** ${env.node}`,
		`- **OS:** ${env.os}`,
		`- **Commit:** ${env.commit || 'unknown'}`,
		`- **Sources root:** ${env.sourcesRoot || 'unknown'}`,
		`- **Source metadata config:** ${env.sourceMetadataConfigPath || 'unknown'}`,
		'',
		`### Validation issues (${errorCount})`,
		'',
		bullet(issues),
		'',
		'### Files parsed to 0 rows',
		'',
		bullet(zeroRowFiles),
		'',
		'### Build console (last lines)',
		'',
		'```text',
		logText,
		'```',
	].join('\n');
}

function issueUrl({ title = '', body = '' }) {
	const params = new URLSearchParams({ template: BUG_TEMPLATE_FILE, title, body });
	return `${REPO_URL}/issues/new?${params.toString()}`;
}

/**
 * Produces everything a user needs to understand a build failure and either fix it
 * themselves or file a useful bug report.
 * @param {object} options
 * @param {Error} options.error - The thrown build error (may carry `validationErrors` and `report`)
 * @param {Array<{level?: string, message: string}>} [options.logs] - Build console entries
 * @param {'cli'|'web'} [options.mode]
 * @param {boolean} [options.writeNyaDb]
 * @param {object} [options.context] - { sourcesRoot, sourceMetadataConfigPath }
 * @returns {object} Machine- and human-readable failure report
 */
function buildFailureReport({ error = {}, logs = [], mode = 'cli', writeNyaDb = false, context = {} }) {
	const errors = error?.validationErrors || [];
	const errorCount = errors.length;
	const zeroRowFiles = detectZeroRowFiles(logs);
	const selfHelp = selfHelpSuggestions({ errors, zeroRowFiles, sourcesRoot: context.sourcesRoot });
	const issues = errors.slice(0, MAX_ISSUES);
	const summary =
		errorCount ? `Build failed: ${errorCount} validation issue(s) found. Nothing was written to NyaDB.` : error?.message || 'Build failed with an unknown error.';
	const env = {
		version: collectVersion(),
		commit: collectCommit(),
		node: process.version,
		os: `${os.platform()} ${os.release()}`,
		mode,
		writeNyaDb,
		sourcesRoot: context.sourcesRoot || null,
		sourceMetadataConfigPath: context.sourceMetadataConfigPath || null,
	};
	const bugReportBody = formatBugBody({ summary, issues, errorCount, selfHelp, zeroRowFiles, env, logs: logs.slice(-MAX_LOG_LINES) });

	return {
		summary,
		issues,
		truncatedIssueCount: Math.max(0, errorCount - issues.length),
		selfHelp,
		zeroRowFiles,
		env,
		bugReportUrl: issueUrl({ title: summary, body: bugReportBody }),
		bugReportBody,
		issuesUrl: ISSUES_URL,
	};
}

/**
 * Renders the failure report as terminal lines (used by the CLI).
 * @returns {string[]}
 */
function formatCliFailure(report) {
	const lines = [];
	lines.push(`Build failed ✖ ${report.summary}`);
	if (report.issues.length) {
		lines.push(`\n${report.issues.length} issue(s) to fix:`);
		for (const issue of report.issues) lines.push(`  • ${shortenErrorIds(issue)}`);
		if (report.truncatedIssueCount) lines.push(`  • …and ${report.truncatedIssueCount} more.`);
	}
	lines.push('\nHow to fix this yourself:');
	for (const hint of report.selfHelp) lines.push(`  - ${hint}`);
	lines.push(`\nDocs: ${validateSourceMetadataConfigDocs}`);
	lines.push('\nIf the hints above do not help, this may be a tool bug or a source format we have not seen yet.');
	lines.push(`Open a pre-filled bug report: ${report.bugReportUrl}`);
	lines.push(`…or paste the block below into a new issue at ${report.issuesUrl}`);
	lines.push('------------------- BEGIN BUG REPORT -------------------');
	lines.push(report.bugReportBody);
	lines.push('-------------------- END BUG REPORT --------------------');
	return lines;
}

module.exports = {
	REPO_URL,
	ISSUES_URL,
	detectZeroRowFiles,
	selfHelpSuggestions,
	buildFailureReport,
	formatCliFailure,
};
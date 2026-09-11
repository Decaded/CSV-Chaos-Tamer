---
name: Build / parser failure
about: Report a build failure so it can be diagnosed and fixed
title: 'Build failed: '
labels: bug
assignees: ''

---

> When a build fails, the CLI and the web panel print a fail report with a "Self-service
> checklist" and diagnostics. Fill in what you can from that report; the GitHub pre-filled
> issue button copies most of it automatically.

## What failed

A short description of the build failure you see. Paste the first lines of the error here.

## How to reproduce

1. What triggered it (e.g. `npm run build`, or "Run build" in the web panel).
2. Which source folder/file was involved, if known.
3. Current branch or changed folders (`git status`).

## Diagnostics

Fill what you can from the fail report:

- **App version:** e.g. `v2.0.0`
- **Mode:** CLI / web panel
- **Write mode:** write (NyaDB updated) / dry run (NyaDB untouched)
- **Node version:**
- **OS:**
- **Commit:**
- **Sources root:**
- **Source metadata config path:**
- **Files parsed to 0 rows:** list them (the fail report shows these)

## Validation issues

Paste the full validation list from the fail report here (or `—` if none).

## Expected behaviour

What you expected to happen instead.

## Logs

Paste the last build console lines, if available.

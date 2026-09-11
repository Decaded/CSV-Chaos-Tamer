function reportPreparedData({ dataset, sources, origins, grouped, items, changedIdCount, reusedOrRetiredIdCount, validationErrorCount }) {
	const chapterKeys = new Set();
	let adultPerkCount = 0;
	for (const item of items) {
		if (item.perk.isAdult) adultPerkCount += 1;
		chapterKeys.add(`${item.originId}/${item.chapterKey}`);
	}
	const duplicateIdCount = items.length - new Set(items.map(item => item.perk.id)).size;

	return {
		datasetVersion: dataset.datasetVersion,
		perkCount: items.length,
		adultPerkCount,
		sourceCount: sources.length,
		editionCount: sources.reduce((count, source) => count + source.editions.length, 0),
		originCount: origins.length,
		chapterCount: chapterKeys.size,
		duplicateIdCount,
		changedIdCountSincePreviousRender: changedIdCount,
		reusedOrRetiredIdCount,
		validationErrorCount,
		databaseCount: Object.keys(grouped).length,
	};
}

module.exports = { reportPreparedData };
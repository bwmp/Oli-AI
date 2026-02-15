export function sanitizeAiOutput(text: string, botName?: string): string {
	if (!text) return text;

	let out = text.trim();
	const name = (botName || process.env.AI_NAME || 'Pookie').trim();
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const labels = [escapedName, `${escapedName}\\s*bot`, 'assistant', 'bot'];
	const prefixPattern = new RegExp(`^\\s*(?:${labels.join('|')})\\s*[:\\-–—]\\s*`, 'i');
	const metadataLinePattern = new RegExp(
		`^\\s*\\[(?:Channel:\\s*[^\\]]+|User:\\s*[^\\]]+|Assistant|${escapedName}(?:\\s*\\|\\s*id=[^\\]]+)?)\\]\\s*$`,
		'i'
	);

	// Strip leading internal metadata blocks like:
	// [Channel: #general | id=...]
	// [User: Name | id=...]
	// [Assistant]
	const lines = out.split('\n');
	let start = 0;
	while (start < lines.length) {
		const line = lines[start].trim();
		if (!line) {
			start++;
			continue;
		}
		if (metadataLinePattern.test(line)) {
			start++;
			continue;
		}
		break;
	}
	if (start > 0) {
		out = lines.slice(start).join('\n').trim();
	}

	for (let i = 0; i < 3; i++) {
		const next = out.replace(prefixPattern, '').trim();
		if (next === out) break;
		out = next;
	}

	return out;
}

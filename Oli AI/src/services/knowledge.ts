import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const KNOWLEDGE_FILE = join(DATA_DIR, 'knowledge.json');

export interface KnowledgeEntry {
	/** What was learned */
	fact: string;
	/** Category: correction, server_lore, inside_joke, general, preference */
	category: string;
	/** Who triggered this learning (username) */
	source: string;
	/** When it was learned */
	learnedAt: string;
	/** How many times this has been reinforced/referenced */
	reinforced: number;
}

export interface ChannelSummary {
	/** Channel ID */
	channelId: string;
	/** Compressed summary of past conversations */
	summary: string;
	/** When this summary was last updated */
	updatedAt: string;
	/** How many messages were summarized into this */
	messageCount: number;
}

interface KnowledgeStore {
	facts: KnowledgeEntry[];
	channelSummaries: Record<string, ChannelSummary>;
}

let store: KnowledgeStore = {
	facts: [],
	channelSummaries: {},
};
let dirty = false;

const MAX_FACTS = 200;
const MAX_SUMMARY_LENGTH = 1500;

// ─── Persistence ──────────────────────────────────────────

export function loadKnowledge(): void {
	try {
		if (!existsSync(DATA_DIR)) {
			mkdirSync(DATA_DIR, { recursive: true });
		}
		if (existsSync(KNOWLEDGE_FILE)) {
			const raw = readFileSync(KNOWLEDGE_FILE, 'utf-8');
			store = JSON.parse(raw) as KnowledgeStore;
			if (!store.facts) store.facts = [];
			if (!store.channelSummaries) store.channelSummaries = {};
			logger.info(`Loaded ${store.facts.length} knowledge entries, ${Object.keys(store.channelSummaries).length} channel summaries`);
		}
	} catch (error: any) {
		logger.error(`Failed to load knowledge: ${error.message}`);
	}
}

export function saveKnowledge(): void {
	if (!dirty) return;
	try {
		if (!existsSync(DATA_DIR)) {
			mkdirSync(DATA_DIR, { recursive: true });
		}
		writeFileSync(KNOWLEDGE_FILE, JSON.stringify(store, null, 2), 'utf-8');
		dirty = false;
	} catch (error: any) {
		logger.error(`Failed to save knowledge: ${error.message}`);
	}
}

// ─── Facts / Corrections ─────────────────────────────────

/**
 * Add a learned fact to the knowledge base.
 * Deduplicates by checking for similar existing facts.
 */
export function addFact(fact: string, category: string, source: string): void {
	const trimmed = fact.trim();
	if (!trimmed || trimmed.length < 5) return;

	// Check for duplicates or similar facts
	const existing = store.facts.find(f =>
		f.fact.toLowerCase() === trimmed.toLowerCase() ||
		f.fact.toLowerCase().includes(trimmed.toLowerCase()) ||
		trimmed.toLowerCase().includes(f.fact.toLowerCase())
	);

	if (existing) {
		// Reinforce existing fact
		existing.reinforced++;
		existing.learnedAt = new Date().toISOString();
		dirty = true;
		saveKnowledge();
		return;
	}

	store.facts.push({
		fact: trimmed,
		category,
		source,
		learnedAt: new Date().toISOString(),
		reinforced: 0,
	});

	// Cap facts - remove least reinforced oldest facts
	while (store.facts.length > MAX_FACTS) {
		// Sort by reinforced count (ascending), then by date (ascending)
		// Remove the least useful one
		let worstIdx = 0;
		let worstScore = Infinity;
		for (let i = 0; i < store.facts.length; i++) {
			const f = store.facts[i];
			const age = Date.now() - new Date(f.learnedAt).getTime();
			const score = f.reinforced * 1000000 - age; // Higher = more valuable
			if (score < worstScore) {
				worstScore = score;
				worstIdx = i;
			}
		}
		store.facts.splice(worstIdx, 1);
	}

	dirty = true;
	saveKnowledge();
}

/**
 * Add multiple facts at once.
 */
export function addFacts(facts: { fact: string; category: string }[], source: string): void {
	for (const f of facts) {
		addFact(f.fact, f.category, source);
	}
}

/**
 * Get all facts, optionally filtered by category.
 */
export function getFacts(category?: string): KnowledgeEntry[] {
	if (category) {
		return store.facts.filter(f => f.category === category);
	}
	return [...store.facts];
}

/**
 * Delete a fact by index.
 */
export function deleteFact(index: number): boolean {
	if (index < 0 || index >= store.facts.length) return false;
	store.facts.splice(index, 1);
	dirty = true;
	saveKnowledge();
	return true;
}

/**
 * Clear all facts.
 */
export function clearFacts(): void {
	store.facts = [];
	dirty = true;
	saveKnowledge();
}

/**
 * Build a knowledge context string for the system prompt.
 * Prioritizes corrections and highly reinforced facts.
 */
export function buildKnowledgeContext(): string {
	if (store.facts.length === 0) return '';

	// Sort: corrections first, then by reinforced count
	const sorted = [...store.facts].sort((a, b) => {
		if (a.category === 'correction' && b.category !== 'correction') return -1;
		if (b.category === 'correction' && a.category !== 'correction') return 1;
		return b.reinforced - a.reinforced;
	});

	// Take top facts (don't bloat the prompt)
	const topFacts = sorted.slice(0, 50);

	const corrections = topFacts.filter(f => f.category === 'correction');
	const serverLore = topFacts.filter(f => f.category === 'server_lore' || f.category === 'inside_joke');
	const general = topFacts.filter(f => f.category === 'general' || f.category === 'preference');

	const parts: string[] = [];

	if (corrections.length > 0) {
		parts.push(`Things you've been corrected on (DO NOT make these mistakes again): ${corrections.map(f => f.fact).join('. ')}.`);
	}
	if (serverLore.length > 0) {
		parts.push(`Server lore and inside jokes you know about: ${serverLore.map(f => f.fact).join('. ')}.`);
	}
	if (general.length > 0) {
		parts.push(`Other things you've learned over time: ${general.map(f => f.fact).join('. ')}.`);
	}

	return parts.join('\n');
}

// ─── Channel Summaries ───────────────────────────────────

/**
 * Get the summary for a channel.
 */
export function getChannelSummary(channelId: string): ChannelSummary | null {
	return store.channelSummaries[channelId] || null;
}

/**
 * Update the summary for a channel.
 */
export function setChannelSummary(channelId: string, summary: string, messageCount: number): void {
	// Truncate if too long
	const trimmed = summary.length > MAX_SUMMARY_LENGTH
		? summary.slice(0, MAX_SUMMARY_LENGTH) + '...'
		: summary;

	store.channelSummaries[channelId] = {
		channelId,
		summary: trimmed,
		updatedAt: new Date().toISOString(),
		messageCount,
	};
	dirty = true;
	saveKnowledge();
}

/**
 * Remove summary for a single channel.
 */
export function clearChannelSummary(channelId: string): void {
	if (!store.channelSummaries[channelId]) return;
	delete store.channelSummaries[channelId];
	dirty = true;
	saveKnowledge();
}

/**
 * Clear all channel summaries while keeping facts.
 */
export function clearAllChannelSummaries(): void {
	store.channelSummaries = {};
	dirty = true;
	saveKnowledge();
}

/**
 * Build channel summary context for the system prompt.
 */
export function buildSummaryContext(channelId: string): string {
	const summary = store.channelSummaries[channelId];
	if (!summary) return '';
	return `Rolling channel summary from older messages:\n${summary.summary}`;
}

// Auto-save every 60 seconds
setInterval(saveKnowledge, 60_000);

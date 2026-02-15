import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { GuildMember, User } from 'discord.js';

const DATA_DIR = join(process.cwd(), 'data');
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');

export interface UserProfile {
	userId: string;
	/** The name Oli knows them by (might be a nickname the AI picks up) */
	knownName: string;
	/** Their actual Discord username (e.g. "cooldude") */
	username: string;
	/** Their current Discord display name / global name */
	displayName: string;
	/** Their server nickname (if any) */
	serverNickname: string | null;
	/** Their Discord bio / about me */
	bio: string | null;
	/** When their Discord account was created */
	accountCreated: string | null;
	/** When they joined the server */
	joinedServer: string | null;
	/** Their top role in the server */
	topRole: string | null;
	/** When the bot first saw them */
	firstSeen: string;
	/** When the bot last talked to them */
	lastSeen: string;
	/** Total messages the bot has seen from them */
	messageCount: number;
	/** Things the AI has learned/remembered about this person */
	notes: string[];
	/** Structured memory by user id for prompt injection */
	memoryCard: MemoryCard;
}

export interface MemoryCard {
	likes: string[];
	dislikes: string[];
	preferences: string[];
	context: string[];
	updatedAt: string;
}

export interface MemoryCardUpdate {
	likes?: string[];
	dislikes?: string[];
	preferences?: string[];
	context?: string[];
}

// In-memory cache
let profiles: Map<string, UserProfile> = new Map();
let dirty = false;

const MAX_NOTES = 30;
const MAX_CARD_ITEMS_PER_SECTION = 12;
const SENSITIVE_MEMORY_PATTERN = /\b(password|passcode|pin\b|social security|ssn\b|credit\s*card|bank\s*account|routing\s*number|home\s*address|street\s*address|phone\s*number|email\s*address|medical\s*record|diagnos(?:is|ed)|therapy|trauma)\b/i;

function createEmptyMemoryCard(): MemoryCard {
	return {
		likes: [],
		dislikes: [],
		preferences: [],
		context: [],
		updatedAt: new Date().toISOString(),
	};
}

function normalizeProfile(raw: Partial<UserProfile>, fallbackUserId: string, fallbackDisplayName: string): UserProfile {
	const memoryCard = raw.memoryCard || createEmptyMemoryCard();
	return {
		userId: raw.userId || fallbackUserId,
		knownName: raw.knownName || fallbackDisplayName,
		username: raw.username || '',
		displayName: raw.displayName || fallbackDisplayName,
		serverNickname: raw.serverNickname ?? null,
		bio: raw.bio ?? null,
		accountCreated: raw.accountCreated ?? null,
		joinedServer: raw.joinedServer ?? null,
		topRole: raw.topRole ?? null,
		firstSeen: raw.firstSeen || new Date().toISOString(),
		lastSeen: raw.lastSeen || new Date().toISOString(),
		messageCount: typeof raw.messageCount === 'number' ? raw.messageCount : 0,
		notes: Array.isArray(raw.notes) ? raw.notes : [],
		memoryCard: {
			likes: Array.isArray(memoryCard.likes) ? memoryCard.likes : [],
			dislikes: Array.isArray(memoryCard.dislikes) ? memoryCard.dislikes : [],
			preferences: Array.isArray(memoryCard.preferences) ? memoryCard.preferences : [],
			context: Array.isArray(memoryCard.context) ? memoryCard.context : [],
			updatedAt: memoryCard.updatedAt || new Date().toISOString(),
		},
	};
}

function normalizeMemoryItem(item: string): string {
	return item
		.replace(/\s+/g, ' ')
		.replace(/^['"`\s]+|['"`\s]+$/g, '')
		.replace(/[.,!?;:]+$/g, '')
		.trim();
}

function isSafeMemoryItem(item: string): boolean {
	if (!item) return false;
	if (item.length < 3 || item.length > 120) return false;
	if (SENSITIVE_MEMORY_PATTERN.test(item)) return false;
	return true;
}

function pushUniqueCapped(target: string[], candidate: string): boolean {
	const normalized = normalizeMemoryItem(candidate);
	if (!isSafeMemoryItem(normalized)) return false;

	const lower = normalized.toLowerCase();
	const dup = target.some(existing => {
		const current = existing.toLowerCase();
		return current === lower || current.includes(lower) || lower.includes(current);
	});
	if (dup) return false;

	target.push(normalized);
	while (target.length > MAX_CARD_ITEMS_PER_SECTION) {
		target.shift();
	}
	return true;
}

/**
 * Load profiles from disk on startup.
 */
export function loadProfiles(): void {
	try {
		if (!existsSync(DATA_DIR)) {
			mkdirSync(DATA_DIR, { recursive: true });
		}
		if (existsSync(PROFILES_FILE)) {
			const raw = readFileSync(PROFILES_FILE, 'utf-8');
			const data = JSON.parse(raw) as Record<string, Partial<UserProfile>>;
			profiles = new Map(
				Object.entries(data).map(([id, p]) => [
					id,
					normalizeProfile(p, id, p.displayName || p.knownName || id),
				])
			);
			logger.info(`Loaded ${profiles.size} user profiles`);
		}
	} catch (error: any) {
		logger.error(`Failed to load profiles: ${error.message}`);
	}
}

/**
 * Save profiles to disk. Called periodically and on updates.
 */
export function saveProfiles(): void {
	if (!dirty) return;
	try {
		if (!existsSync(DATA_DIR)) {
			mkdirSync(DATA_DIR, { recursive: true });
		}
		const data: Record<string, UserProfile> = Object.fromEntries(profiles);
		writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2), 'utf-8');
		dirty = false;
	} catch (error: any) {
		logger.error(`Failed to save profiles: ${error.message}`);
	}
}

/**
 * Get or create a profile for a user.
 */
export function getProfile(userId: string, displayName: string): UserProfile {
	let profile = profiles.get(userId);
	if (!profile) {
		profile = {
			userId,
			knownName: displayName,
			username: '',
			displayName,
			serverNickname: null,
			bio: null,
			accountCreated: null,
			joinedServer: null,
			topRole: null,
			firstSeen: new Date().toISOString(),
			lastSeen: new Date().toISOString(),
			messageCount: 0,
			notes: [],
			memoryCard: createEmptyMemoryCard(),
		};
		profiles.set(userId, profile);
		dirty = true;
	} else if (!profile.memoryCard) {
		profile.memoryCard = createEmptyMemoryCard();
		dirty = true;
	}

	// Update display name if it changed
	if (profile.displayName !== displayName) {
		profile.displayName = displayName;
		dirty = true;
	}

	return profile;
}

/**
 * Update a profile with fresh Discord user/member data.
 * Call this with the full User (fetched with force) and GuildMember.
 */
export function updateDiscordInfo(userId: string, user: User, member: GuildMember | null): void {
	const profile = profiles.get(userId);
	if (!profile) return;

	profile.username = user.username;
	profile.displayName = user.displayName || user.globalName || user.username;

	// Bio comes from fetching the full user (user.fetch({ force: true }))
	// The 'banner' field gets populated but 'bio' is available via the API
	// discord.js doesn't expose bio directly, but we can get it from the raw data
	if ((user as any).bio) {
		profile.bio = (user as any).bio;
	}

	profile.accountCreated = user.createdAt.toISOString();

	if (member) {
		profile.serverNickname = member.nickname;
		profile.joinedServer = member.joinedAt?.toISOString() || null;
		// Get their highest colored/meaningful role (skip @everyone)
		const topRole = member.roles.cache
			.filter(r => r.name !== '@everyone')
			.sort((a, b) => b.position - a.position)
			.first();
		profile.topRole = topRole?.name || null;
	}

	dirty = true;
}

/**
 * Record that a user sent a message.
 */
export function touchProfile(userId: string, displayName: string): UserProfile {
	const profile = getProfile(userId, displayName);
	profile.lastSeen = new Date().toISOString();
	profile.messageCount++;
	dirty = true;
	return profile;
}

/**
 * Add notes to a user's profile (things the AI learned about them).
 * Deduplicates and caps at 30 notes - removes oldest when full.
 */
export function addNotes(userId: string, newNotes: string[]): void {
	const profile = profiles.get(userId);
	if (!profile) return;

	for (const note of newNotes) {
		const trimmed = normalizeMemoryItem(note);
		if (!isSafeMemoryItem(trimmed)) continue;

		// Skip if we already have a very similar note
		const isDuplicate = profile.notes.some(existing =>
			existing.toLowerCase() === trimmed.toLowerCase() ||
			existing.toLowerCase().includes(trimmed.toLowerCase()) ||
			trimmed.toLowerCase().includes(existing.toLowerCase())
		);
		if (isDuplicate) continue;

		profile.notes.push(trimmed);
	}

	// Cap notes - remove oldest if over limit
	while (profile.notes.length > MAX_NOTES) {
		profile.notes.shift();
	}

	dirty = true;
	saveProfiles();
}

export function inferMemoryCardUpdate(message: string): MemoryCardUpdate {
	const text = message.trim();
	const updates: MemoryCardUpdate = {};

	const collect = (patterns: RegExp[]): string[] => {
		const out: string[] = [];
		for (const pattern of patterns) {
			const match = text.match(pattern);
			if (!match || !match[1]) continue;
			const candidate = normalizeMemoryItem(match[1]);
			if (isSafeMemoryItem(candidate)) out.push(candidate);
		}
		return out;
	};

	updates.likes = collect([
		/\bi\s+(?:really\s+)?(?:like|love|enjoy)\s+([^.!?\n]{2,80})/i,
		/\bmy\s+favorite\s+(?:thing|food|game|music|movie)?\s*(?:is|are)\s+([^.!?\n]{2,80})/i,
	]);
	updates.dislikes = collect([
		/\bi\s+(?:really\s+)?(?:hate|dislike|can't\s+stand)\s+([^.!?\n]{2,80})/i,
		/\bi\s+do\s+not\s+like\s+([^.!?\n]{2,80})/i,
	]);
	updates.preferences = collect([
		/\bi\s+prefer\s+([^.!?\n]{2,80})/i,
		/\bi'?d\s+rather\s+([^.!?\n]{2,80})/i,
	]);
	updates.context = collect([
		/\bi(?:'m|\s+am)\s+(?:working\s+on|building|planning\s+to|trying\s+to|learning)\s+([^.!?\n]{2,100})/i,
	]);

	return updates;
}

export function addMemoryCardUpdate(userId: string, update: MemoryCardUpdate): void {
	const profile = profiles.get(userId);
	if (!profile) return;
	if (!profile.memoryCard) profile.memoryCard = createEmptyMemoryCard();

	let changed = false;
	for (const like of update.likes || []) {
		changed = pushUniqueCapped(profile.memoryCard.likes, like) || changed;
	}
	for (const dislike of update.dislikes || []) {
		changed = pushUniqueCapped(profile.memoryCard.dislikes, dislike) || changed;
	}
	for (const pref of update.preferences || []) {
		changed = pushUniqueCapped(profile.memoryCard.preferences, pref) || changed;
	}
	for (const ctx of update.context || []) {
		changed = pushUniqueCapped(profile.memoryCard.context, ctx) || changed;
	}

	if (changed) {
		profile.memoryCard.updatedAt = new Date().toISOString();
		dirty = true;
		saveProfiles();
	}
}

export function learnFromMessage(userId: string, message: string): void {
	const inferred = inferMemoryCardUpdate(message);
	addMemoryCardUpdate(userId, inferred);
}

export function buildMemoryCardsContext(userIds: string[]): string {
	const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
	if (uniqueUserIds.length === 0) return '';

	const blocks: string[] = [];
	for (const userId of uniqueUserIds) {
		const profile = profiles.get(userId);
		if (!profile || !profile.memoryCard) continue;

		const card = profile.memoryCard;
		const hasData = card.likes.length > 0 || card.dislikes.length > 0 || card.preferences.length > 0 || card.context.length > 0;
		if (!hasData) continue;

		const lines: string[] = [
			`[User Memory Card: ${profile.displayName || profile.knownName} | id=${profile.userId}]`,
		];
		if (card.likes.length > 0) lines.push(`- likes: ${card.likes.join('; ')}`);
		if (card.dislikes.length > 0) lines.push(`- dislikes: ${card.dislikes.join('; ')}`);
		if (card.preferences.length > 0) lines.push(`- preferences: ${card.preferences.join('; ')}`);
		if (card.context.length > 0) lines.push(`- running_context: ${card.context.join('; ')}`);

		blocks.push(lines.join('\n'));
	}

	if (blocks.length === 0) return '';
	return `[Memory Cards]\n${blocks.join('\n\n')}`;
}

/**
 * Update the nickname the AI knows someone by.
 */
export function setKnownName(userId: string, name: string): void {
	const profile = profiles.get(userId);
	if (!profile) return;
	profile.knownName = name;
	dirty = true;
	saveProfiles();
}

/**
 * Build a context string about a user for the AI system prompt.
 */
export function buildProfileContext(userId: string): string {
	const profile = profiles.get(userId);
	if (!profile) return '';

	const parts: string[] = [];

	// Identity info - always include so the AI knows who it's talking to
	const names: string[] = [];
	if (profile.username) names.push(`username: ${profile.username}`);
	if (profile.displayName) names.push(`display name: ${profile.displayName}`);
	if (profile.serverNickname) names.push(`server nickname: ${profile.serverNickname}`);
	if (profile.knownName !== profile.displayName && profile.knownName !== profile.username) {
		names.push(`you call them: ${profile.knownName}`);
	}

	parts.push(`You are talking to someone with ${names.join(', ')}.`);

	if (profile.messageCount > 50) {
		parts.push(`You've talked to them a lot, they're a regular.`);
	} else if (profile.messageCount > 10) {
		parts.push(`You've chatted with them a few times before.`);
	} else if (profile.messageCount <= 2) {
		parts.push(`You don't really know them yet, they're pretty new.`);
	}

	if (profile.memoryCard) {
		const cardBits: string[] = [];
		if (profile.memoryCard.likes.length > 0) cardBits.push(`likes: ${profile.memoryCard.likes.join(', ')}`);
		if (profile.memoryCard.dislikes.length > 0) cardBits.push(`dislikes: ${profile.memoryCard.dislikes.join(', ')}`);
		if (profile.memoryCard.preferences.length > 0) cardBits.push(`preferences: ${profile.memoryCard.preferences.join(', ')}`);
		if (profile.memoryCard.context.length > 0) cardBits.push(`running context: ${profile.memoryCard.context.join(', ')}`);
		if (cardBits.length > 0) {
			parts.push(`Memory card for this user (${profile.userId}): ${cardBits.join(' | ')}.`);
		}
	}

	if (profile.notes.length > 0) {
		parts.push(`Background notes (only mention if directly relevant): ${profile.notes.join('. ')}.`);
	}

	return parts.join(' ');
}

/**
 * Get all profiles (for the /profile command).
 */
export function getAllProfiles(): Map<string, UserProfile> {
	return profiles;
}

/**
 * Delete a user's profile.
 */
export function deleteProfile(userId: string): boolean {
	const existed = profiles.delete(userId);
	if (existed) {
		dirty = true;
		saveProfiles();
	}
	return existed;
}

// Auto-save every 60 seconds
setInterval(saveProfiles, 60_000);

import { ACTION_INSTRUCTIONS } from '~/services/actions';
import { buildKnowledgeContext, buildSummaryContext, getChannelSummary, setChannelSummary } from '~/services/knowledge';
import { buildMemoryCardsContext } from '~/services/profiles';

interface OllamaMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface OllamaResponse {
	message: OllamaMessage;
	done: boolean;
}

export interface ConversationEntry {
	role: 'user' | 'assistant';
	content: string;
	userId?: string;
	username?: string;
	timestamp: number;
}

export interface RecentChannelMessage {
	author: string;
	authorId: string;
	content: string;
	isBot: boolean;
}

export interface ChatRequest {
	channelId: string;
	channelName?: string;
	username: string;
	userId: string;
	message: string;
	userContext?: string;
	recentMessages?: RecentChannelMessage[];
}

interface ChannelState {
	history: ConversationEntry[];
	userMessagesSinceSummary: number;
}

interface RuntimeConfig {
	host: string;
	model: string;
	timeout: number;
	numCtx: number;
	temperature: number;
	topP: number;
	historyLastK: number;
	summaryEveryNMessages: number;
	contextUtilization: number;
}

const conversationHistory: Map<string, ChannelState> = new Map();

let currentPersonality: string = process.env.AI_PERSONALITY || 'You are a friendly person in a Discord chat. Be casual and conversational.';

const IDENTITY_RULES = `
Conversation integrity rules (strict):
- Every [User: ... | id=...] line is a distinct identity. Treat each user id as a different person.
- Never attribute one user's statements, preferences, or history to another user id.
- If a question could refer to multiple users and attribution is unclear, ask one brief clarifying question before answering.
- Prefer user ids over display names when they conflict.
- History tags like [Channel: ...], [User: ...], and [Assistant] are input metadata only. Never include them in final user-visible replies.
`.trim();

const SAFETY_RULES = `
Safety rules:
- Do not assist with harassment, hate, threats, or targeted abuse.
- Do not provide guidance that meaningfully facilitates illegal wrongdoing.
- Refuse requests involving sexual content with minors.
- When refusing, stay brief and offer a safer alternative.
`.trim();

export function getPersonality(): string {
	return currentPersonality;
}

export function setPersonality(personality: string): void {
	currentPersonality = personality;
}

export function getHistory(channelId: string): OllamaMessage[] {
	const state = conversationHistory.get(channelId);
	if (!state) return [];
	return state.history.map(h => ({ role: h.role, content: h.content }));
}

export function clearHistory(channelId: string): void {
	conversationHistory.set(channelId, { history: [], userMessagesSinceSummary: 0 });
}

export function clearAllHistory(): void {
	conversationHistory.clear();
}

function getConfig(): RuntimeConfig {
	const numCtx = clampInt(process.env.OLLAMA_NUM_CTX, 8192, 2048, 16384);
	return {
		host: process.env.OLLAMA_HOST || 'http://localhost:11434',
		model: process.env.OLLAMA_MODEL || 'mistral-nemo',
		timeout: clampInt(process.env.OLLAMA_TIMEOUT, 120000, 10000, 600000),
		numCtx,
		temperature: clampFloat(process.env.OLLAMA_TEMPERATURE, 0.7, 0, 1.5),
		topP: clampFloat(process.env.OLLAMA_TOP_P, 0.9, 0.1, 1),
		historyLastK: clampInt(process.env.AI_HISTORY_LAST_K, 18, 6, 60),
		summaryEveryNMessages: clampInt(process.env.AI_SUMMARY_EVERY_N_MESSAGES, 12, 4, 100),
		contextUtilization: clampFloat(process.env.AI_CONTEXT_UTILIZATION, 0.82, 0.5, 0.92),
	};
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
	const parsed = parseInt(raw || `${fallback}`, 10);
	if (isNaN(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

function clampFloat(raw: string | undefined, fallback: number, min: number, max: number): number {
	const parsed = parseFloat(raw || `${fallback}`);
	if (isNaN(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

function getChannelState(channelId: string): ChannelState {
	let state = conversationHistory.get(channelId);
	if (!state) {
		state = { history: [], userMessagesSinceSummary: 0 };
		conversationHistory.set(channelId, state);
	}
	return state;
}

function channelLabel(channelId: string, channelName?: string): string {
	if (!channelName) return channelId;
	return channelName.startsWith('#') ? channelName : `#${channelName}`;
}

export function formatUserHistoryBlock(channelId: string, channelName: string | undefined, username: string, userId: string, content: string): string {
	return `[Channel: ${channelLabel(channelId, channelName)} | id=${channelId}]\n[User: ${username} | id=${userId}]\n${content.trim()}`;
}

export function formatAssistantHistoryBlock(channelId: string, channelName: string | undefined, content: string): string {
	return `[Channel: ${channelLabel(channelId, channelName)} | id=${channelId}]\n[Assistant]\n${content.trim()}`;
}

function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

function estimateMessageTokens(messages: OllamaMessage[]): number {
	return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 8, 0);
}

export function detectTopicShift(latestMessage: string, previousMessages: string[]): boolean {
	if (previousMessages.length < 2) return false;
	const latestTerms = new Set(tokenize(latestMessage));
	if (latestTerms.size === 0) return false;

	const previousTerms = new Set(previousMessages.flatMap(tokenize));
	if (previousTerms.size === 0) return false;

	let overlap = 0;
	for (const term of latestTerms) {
		if (previousTerms.has(term)) overlap++;
	}
	const ratio = overlap / latestTerms.size;
	return ratio < 0.18;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter(token => token.length >= 4)
		.slice(0, 64);
}

function collectParticipantIds(state: ChannelState, currentUserId: string, recentMessages?: RecentChannelMessage[]): string[] {
	const ids = new Set<string>();
	ids.add(currentUserId);

	for (const entry of state.history.slice(-20)) {
		if (entry.role === 'user' && entry.userId) ids.add(entry.userId);
	}

	for (const msg of recentMessages || []) {
		if (!msg.isBot && msg.authorId) ids.add(msg.authorId);
	}

	return [...ids].slice(0, 12);
}

function buildRecentActivityBlock(channelId: string, channelName: string | undefined, recentMessages?: RecentChannelMessage[]): string {
	if (!recentMessages || recentMessages.length === 0) return '';
	const lines = ['[Recent Channel Activity]'];

	for (const msg of recentMessages.slice(-6)) {
		if (!msg.content?.trim()) continue;
		if (msg.isBot) {
			lines.push(formatAssistantHistoryBlock(channelId, channelName, msg.content));
		} else {
			lines.push(formatUserHistoryBlock(channelId, channelName, msg.author, msg.authorId, msg.content));
		}
	}

	return lines.length > 1 ? lines.join('\n\n') : '';
}

function buildSystemPrompt(request: ChatRequest, participantIds: string[], recentMessages: RecentChannelMessage[] | undefined): string {
	let systemPrompt = `${currentPersonality}\n\n${IDENTITY_RULES}\n\n${SAFETY_RULES}`;

	if (request.userContext) {
		systemPrompt += `\n\n[Active Speaker Context | id=${request.userId}]\n${request.userContext}`;
	}

	const memoryContext = buildMemoryCardsContext(participantIds);
	if (memoryContext) {
		systemPrompt += `\n\n${memoryContext}`;
	}

	const summaryContext = buildSummaryContext(request.channelId);
	if (summaryContext) {
		systemPrompt += `\n\n[Rolling Summary]\n${summaryContext}`;
	}

	const knowledgeContext = buildKnowledgeContext();
	if (knowledgeContext) {
		systemPrompt += `\n\n[Learned Knowledge]\n${knowledgeContext}`;
	}

	const recentActivity = buildRecentActivityBlock(request.channelId, request.channelName, recentMessages);
	if (recentActivity) {
		systemPrompt += `\n\n${recentActivity}`;
	}

	systemPrompt += `\n\n${ACTION_INSTRUCTIONS}`;

	return systemPrompt;
}

function toPromptHistory(channelId: string, channelName: string | undefined, entry: ConversationEntry): OllamaMessage {
	if (entry.role === 'assistant') {
		return {
			role: 'assistant',
			content: formatAssistantHistoryBlock(channelId, channelName, entry.content),
		};
	}

	return {
		role: 'user',
		content: formatUserHistoryBlock(channelId, channelName, entry.username || 'Unknown User', entry.userId || 'unknown', entry.content),
	};
}

function summaryBulletsFromMessages(messages: ConversationEntry[]): string[] {
	const bullets: string[] = [];

	for (const message of messages) {
		if (!message.content?.trim()) continue;

		if (message.role === 'user') {
			const pref = extractPreferenceFact(message.content, message.username || 'User', message.userId || 'unknown');
			if (pref) {
				bullets.push(pref);
				continue;
			}
		}

		const compact = message.content
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 120);

		if (!compact) continue;

		if (message.role === 'user') {
			bullets.push(`${message.username || 'User'} (id=${message.userId || 'unknown'}): ${compact}`);
		} else {
			bullets.push(`Assistant: ${compact}`);
		}
	}

	return dedupeBullets(bullets).slice(-20);
}

function extractPreferenceFact(content: string, username: string, userId: string): string | null {
	const patterns = [
		/\bi\s+(?:really\s+)?(?:like|love|enjoy)\s+([^.!?\n]{2,80})/i,
		/\bi\s+(?:really\s+)?(?:hate|dislike|can't\s+stand)\s+([^.!?\n]{2,80})/i,
		/\bi\s+prefer\s+([^.!?\n]{2,80})/i,
	];

	for (const pattern of patterns) {
		const match = content.match(pattern);
		if (!match || !match[1]) continue;
		const fact = match[1].replace(/\s+/g, ' ').trim();
		if (!fact) continue;
		if (pattern.source.includes('hate') || pattern.source.includes('dislike') || pattern.source.includes("can't")) {
			return `${username} (id=${userId}) dislikes ${fact}`;
		}
		if (pattern.source.includes('prefer')) {
			return `${username} (id=${userId}) prefers ${fact}`;
		}
		return `${username} (id=${userId}) likes ${fact}`;
	}

	return null;
}

function dedupeBullets(lines: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];

	for (const line of lines) {
		const normalized = line.toLowerCase().trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(line.trim());
	}

	return out;
}

export function mergeRollingSummary(existingSummary: string | undefined, messages: ConversationEntry[], maxBullets = 26): string {
	const existingBullets = (existingSummary || '')
		.split('\n')
		.map(line => line.replace(/^[-*]\s*/, '').trim())
		.filter(Boolean);

	const newBullets = summaryBulletsFromMessages(messages);
	const merged = dedupeBullets([...existingBullets, ...newBullets]).slice(-maxBullets);
	return merged.map(line => `- ${line}`).join('\n');
}

function summarizeIntoRollingContext(channelId: string, messages: ConversationEntry[]): void {
	if (messages.length === 0) return;
	const existing = getChannelSummary(channelId);
	const merged = mergeRollingSummary(existing?.summary, messages);
	const newCount = (existing?.messageCount || 0) + messages.length;
	setChannelSummary(channelId, merged, newCount);
}

function enforceLastKAndSummary(channelId: string, state: ChannelState, config: RuntimeConfig): void {
	if (state.history.length <= config.historyLastK) return;
	const dropCount = state.history.length - config.historyLastK;
	const dropped = state.history.splice(0, dropCount);
	summarizeIntoRollingContext(channelId, dropped);
}

function enforceTokenBudget(channelId: string, request: ChatRequest, state: ChannelState, config: RuntimeConfig): { systemPrompt: string; promptHistory: ConversationEntry[] } {
	const participantIds = collectParticipantIds(state, request.userId, request.recentMessages);
	let systemPrompt = buildSystemPrompt(request, participantIds, request.recentMessages);

	const maxPromptTokens = Math.max(1024, Math.floor(config.numCtx * config.contextUtilization));
	let promptHistory = [...state.history];
	let messages: OllamaMessage[] = [{ role: 'system', content: systemPrompt }, ...promptHistory.map(entry => toPromptHistory(request.channelId, request.channelName, entry))];

	while (estimateMessageTokens(messages) > maxPromptTokens && state.history.length > 2) {
		const overflow = estimateMessageTokens(messages) - maxPromptTokens;
		const average = Math.max(40, Math.floor((estimateMessageTokens(messages) - estimateTokens(systemPrompt)) / Math.max(1, state.history.length)));
		const dropCount = Math.max(1, Math.min(state.history.length - 2, Math.ceil(overflow / average)));
		const dropped = state.history.splice(0, dropCount);
		summarizeIntoRollingContext(channelId, dropped);

		systemPrompt = buildSystemPrompt(request, participantIds, request.recentMessages);
		promptHistory = [...state.history];
		messages = [{ role: 'system', content: systemPrompt }, ...promptHistory.map(entry => toPromptHistory(request.channelId, request.channelName, entry))];
	}

	return { systemPrompt, promptHistory };
}

/**
 * Send a message to Ollama and return the assistant reply.
 * The prompt enforces explicit user ids and keeps memory blocks ahead of history.
 */
export async function chat(request: ChatRequest): Promise<string> {
	const config = getConfig();
	const state = getChannelState(request.channelId);

	const previousUserMessages = state.history
		.filter(entry => entry.role === 'user')
		.slice(-6)
		.map(entry => entry.content);
	const topicShift = detectTopicShift(request.message, previousUserMessages);

	state.history.push({
		role: 'user',
		content: request.message,
		userId: request.userId,
		username: request.username,
		timestamp: Date.now(),
	});

	state.userMessagesSinceSummary++;
	if ((state.userMessagesSinceSummary >= config.summaryEveryNMessages || topicShift) && state.history.length > config.historyLastK) {
		enforceLastKAndSummary(request.channelId, state, config);
		state.userMessagesSinceSummary = 0;
	}

	enforceLastKAndSummary(request.channelId, state, config);

	const { systemPrompt, promptHistory } = enforceTokenBudget(request.channelId, request, state, config);
	const messages: OllamaMessage[] = [
		{ role: 'system', content: systemPrompt },
		...promptHistory.map(entry => toPromptHistory(request.channelId, request.channelName, entry)),
	];

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), config.timeout);

		const response = await fetch(`${config.host}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: config.model,
				messages,
				stream: false,
				options: {
					num_ctx: config.numCtx,
					temperature: config.temperature,
					top_p: config.topP,
				},
			}),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Ollama API error (${response.status}): ${errorText}`);
		}

		const data = await response.json() as OllamaResponse;
		const reply = data.message.content.trim();

		state.history.push({
			role: 'assistant',
			content: reply,
			timestamp: Date.now(),
		});

		const storageCap = Math.max(config.historyLastK + 8, 28);
		if (state.history.length > storageCap) {
			const overflow = state.history.length - storageCap;
			const dropped = state.history.splice(0, overflow);
			summarizeIntoRollingContext(request.channelId, dropped);
		}

		return reply;
	} catch (error: any) {
		const last = state.history[state.history.length - 1];
		if (last?.role === 'user' && last.userId === request.userId && last.content === request.message) {
			state.history.pop();
		}

		if (error.name === 'AbortError') {
			throw new Error('Ollama request timed out - the AI server may be busy or unreachable.');
		}
		throw new Error(`Failed to reach Ollama at ${config.host}: ${error.message}`);
	}
}

/**
 * Ask the AI to extract notable facts about a user from a conversation snippet.
 */
export async function extractMemories(username: string, userMessage: string, botReply: string): Promise<string[]> {
	const config = getConfig();
	const prompt = `You are a memory extraction system. Given this exchange between "${username}" and a bot, extract only non-sensitive, conversation-relevant facts worth remembering.

Allowed: hobbies, likes/dislikes, projects, ongoing goals, preferred styles.
Disallowed: passwords, contact info, financial details, medical/private trauma, home address.

If there is nothing worth remembering, respond with just: NONE

Format: one fact per line, under 15 words each. No numbering.

${username}: ${userMessage}
Bot: ${botReply}`;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000);

		const response = await fetch(`${config.host}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: config.model,
				prompt,
				stream: false,
				options: {
					temperature: 0.1,
					num_ctx: Math.min(config.numCtx, 4096),
					top_p: 0.9,
				},
			}),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);
		if (!response.ok) return [];

		const data = await response.json() as { response: string };
		const text = data.response.trim();
		if (text.toUpperCase().includes('NONE') && text.length < 20) return [];

		return text
			.split('\n')
			.map(line => line.replace(/^[-*•\d.)\s]+/, '').trim())
			.filter(line => line.length > 3 && line.length < 200);
	} catch {
		return [];
	}
}

/**
 * Detect corrections or server knowledge in a conversation snippet.
 */
export async function extractLearning(username: string, userMessage: string, botReply: string, previousBotMessage?: string): Promise<{ fact: string; category: string }[]> {
	const config = getConfig();

	let context = '';
	if (previousBotMessage) {
		context += `Bot previously said: ${previousBotMessage}\n`;
	}
	context += `${username}: ${userMessage}\nBot: ${botReply}`;

	const prompt = `You are a learning extraction system. Analyze this conversation and determine if:
1. The user CORRECTED the bot
2. The user TAUGHT the bot useful server/topic context
3. The user stated stable group preference

Output each learned item as exactly:
CATEGORY: fact

Valid CATEGORY values: correction, server_lore, inside_joke, general, preference

If nothing was learned, reply: NONE

Conversation:\n${context}`;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000);

		const response = await fetch(`${config.host}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: config.model,
				prompt,
				stream: false,
				options: {
					temperature: 0.1,
					num_ctx: Math.min(config.numCtx, 4096),
					top_p: 0.9,
				},
			}),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);
		if (!response.ok) return [];

		const data = await response.json() as { response: string };
		const text = data.response.trim();

		if (text.toUpperCase().includes('NONE') && text.length < 20) return [];

		const results: { fact: string; category: string }[] = [];
		const validCategories = ['correction', 'server_lore', 'inside_joke', 'general', 'preference'];

		for (const line of text.split('\n')) {
			const match = line.match(/^(\w+):\s*(.+)/);
			if (!match) continue;
			const category = match[1].toLowerCase().trim();
			const fact = match[2].trim();
			if (validCategories.includes(category) && fact.length > 5 && fact.length < 300) {
				results.push({ fact, category });
			}
		}

		return results;
	} catch {
		return [];
	}
}

/**
 * Summarize conversation using Ollama (optional high-fidelity path).
 */
export async function summarizeConversation(messages: { role: string; content: string }[], existingSummary?: string): Promise<string | null> {
	const config = getConfig();

	const conversation = messages
		.map(m => `${m.role}: ${m.content}`)
		.join('\n');

	let prompt = `You are a conversation summarizer. Keep a concise bullet summary of key topics, decisions, and user preferences. Keep identity attribution with user names and ids when available.`;
	if (existingSummary) {
		prompt += `\n\nPrevious summary:\n${existingSummary}`;
	}
	prompt += `\n\nConversation:\n${conversation}`;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000);

		const response = await fetch(`${config.host}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: config.model,
				prompt,
				stream: false,
				options: {
					temperature: 0.2,
					num_ctx: Math.min(config.numCtx, 4096),
					top_p: 0.9,
				},
			}),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);
		if (!response.ok) return null;

		const data = await response.json() as { response: string };
		return data.response.trim();
	} catch {
		return null;
	}
}

/**
 * Check if Ollama is reachable and list models.
 */
export async function healthCheck(): Promise<{ ok: boolean; error?: string; models?: string[] }> {
	const host = process.env.OLLAMA_HOST || 'http://localhost:11434';

	try {
		const response = await fetch(`${host}/api/tags`);
		if (!response.ok) {
			return { ok: false, error: `Server returned ${response.status}` };
		}
		const data = await response.json() as { models: { name: string }[] };
		const models = data.models.map((m: { name: string }) => m.name);
		return { ok: true, models };
	} catch (error: any) {
		return { ok: false, error: `Cannot reach Ollama at ${host}: ${error.message}` };
	}
}

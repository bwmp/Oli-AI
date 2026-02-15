import { Client, Message } from 'discord.js';
import { chat, extractMemories, extractLearning } from '~/services/ollama';
import { touchProfile, buildProfileContext, addNotes, updateDiscordInfo, learnFromMessage } from '~/services/profiles';
import { parseActions, executeActions } from '~/services/actions';
import { addFacts } from '~/services/knowledge';
import { sanitizeAiOutput } from '~/utils/aiText';

export default async (client: Client, message: Message) => {
	// Ignore self to avoid loops
	if (message.author.id === client.user?.id) return;

	// Ignore bots unless explicitly whitelisted (for bridge/relay bots)
	const whitelistedBotIds = (process.env.AI_BOT_WHITELIST_IDS || '')
		.split(',')
		.map(id => id.trim())
		.filter(Boolean);
	const isWhitelistedBot = message.author.bot && whitelistedBotIds.includes(message.author.id);
	if (message.author.bot && !isWhitelistedBot) return;
	const bridged = isWhitelistedBot ? parseBridgedMessage(message.content) : null;
	if (isWhitelistedBot && !bridged) return;

	// Check if we should respond in this channel
	const allowedChannels = process.env.AI_CHANNEL_IDS?.split(',').map(id => id.trim()).filter(Boolean);
	if (allowedChannels && allowedChannels.length > 0 && !allowedChannels.includes(message.channelId)) return;
	const configuredBotName = (process.env.AI_NAME || client.user?.displayName || 'Pookie').trim();

	const botNameLower = configuredBotName.toLowerCase();
	const isMentioned = message.mentions.has(client.user!.id);
	const isReply = message.reference?.messageId != null;
	let isReplyToBot = false;
	const bridgedMentionsBot = !!bridged && bridged.content.toLowerCase().includes(botNameLower);

	// Check if it's a reply to one of our messages
	if (isReply) {
		try {
			const repliedTo = await message.channel.messages.fetch(message.reference!.messageId!);
			isReplyToBot = repliedTo.author.id === client.user!.id;
		} catch {
			// Ignore fetch errors
		}
	}

	// Always respond to mentions and replies to the bot
	const directlyAddressed = isMentioned || isReplyToBot || bridgedMentionsBot;

	if (!directlyAddressed) {
		// Random chance to chime in (default 15%)
		const chimeChance = parseFloat(process.env.AI_CHIME_CHANCE || '0.15');
		const roll = Math.random();

		// Boost chance if the bot's name is mentioned casually in text
		const nameInMessage = (bridged?.content || message.content).toLowerCase().includes(botNameLower);
		const effectiveChance = nameInMessage ? Math.min(chimeChance * 3, 1) : chimeChance;

		if (roll > effectiveChance) return;
	}

	// Clean the message content (remove the bot mention if present)
	let content = bridged
		? bridged.content
		: message.content.replace(new RegExp(`<@!?${client.user!.id}>`), '').trim();
	if (!content) return;

	// Show typing indicator while generating
	try {
		if ('sendTyping' in message.channel) {
			await message.channel.sendTyping();
		}
	} catch {
		// Ignore if we can't send typing
	}

	try {
		const username = bridged
			? bridged.username
			: (message.member?.displayName || message.author.displayName || message.author.username);
		const userId = bridged
			? buildBridgeUserId(message.author.id, bridged.username)
			: message.author.id;

		// Touch/create profile and refresh Discord info
		touchProfile(userId, username);

		// Fetch full user data to get bio and other profile info
		if (!bridged) {
			try {
				const fullUser = await message.author.fetch(true);
				updateDiscordInfo(userId, fullUser, message.member);
			} catch {
				// Best effort - still works without full fetch
			}
		}

		const userContext = buildProfileContext(userId);

		// Fetch recent channel messages for conversation context
		let recentMessages: { author: string; authorId: string; content: string; isBot: boolean }[] | undefined;
		try {
			const fetched = await message.channel.messages.fetch({ limit: 10, before: message.id });
			recentMessages = fetched
				.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
				.map(m => {
					const parsedBridge = whitelistedBotIds.includes(m.author.id) ? parseBridgedMessage(m.content) : null;
					const parsedAuthorId = parsedBridge
						? buildBridgeUserId(m.author.id, parsedBridge.username)
						: m.author.id;
					return {
						author: parsedBridge?.username || m.member?.displayName || m.author.displayName || m.author.username,
						authorId: parsedAuthorId,
						content: parsedBridge?.content || m.content || (m.attachments.size > 0 ? '[attachment]' : (m.embeds.length > 0 ? '[embed]' : '[empty]')),
						isBot: m.author.id === client.user!.id,
					};
				})
				.filter(m => m.content && m.content !== '[empty]');
		} catch {
			// Best effort - still works without recent messages
		}

		learnFromMessage(userId, content);

		const rawResponse = await chat({
			channelId: message.channelId,
			channelName: 'name' in message.channel ? (message.channel as any).name : undefined,
			username,
			userId,
			message: content,
			userContext,
			recentMessages,
		});

		// Parse actions from the AI's response
		const { text, actions } = parseActions(rawResponse);

		// Execute all actions (nick changes, reacts, status, etc.)
		const { forceNoReply, embeds, gifs, images } = await executeActions(actions, client, message);

		// Append GIF URLs to text - Discord auto-embeds tenor/giphy/imgur links
		let finalText = sanitizeAiOutput(text, configuredBotName);
		if (gifs.length > 0) {
			const gifBlock = gifs.join('\n');
			finalText = finalText ? `${finalText}\n${gifBlock}` : gifBlock;
		}
		if (images.length > 0) {
			const imageBlock = images.join('\n');
			finalText = finalText ? `${finalText}\n${imageBlock}` : imageBlock;
		}

		// Determine how to send the response
		const shouldReply = directlyAddressed && !forceNoReply;
		const hasText = finalText.length > 0;
		const hasEmbeds = embeds.length > 0;

		// Nothing to send (maybe it was just reactions)
		if (!hasText && !hasEmbeds) {
			fireMemoryExtraction(username, userId, content, rawResponse);
			return;
		}

		// Build send options
		if (shouldReply) {
			if (hasText && finalText.length <= 2000) {
				await message.reply({
					content: finalText,
					embeds: hasEmbeds ? embeds : undefined,
					allowedMentions: { repliedUser: false },
				});
			} else if (hasText) {
				const chunks = splitMessage(finalText);
				for (let i = 0; i < chunks.length; i++) {
					if (i === 0) {
						await message.reply({
							content: chunks[i],
							embeds: hasEmbeds ? embeds : undefined,
							allowedMentions: { repliedUser: false },
						});
					} else {
						await (message.channel as any).send(chunks[i]);
					}
				}
			} else {
				await message.reply({
					embeds,
					allowedMentions: { repliedUser: false },
				});
			}
		} else {
			if (hasText && finalText.length <= 2000) {
				await (message.channel as any).send({
					content: finalText,
					embeds: hasEmbeds ? embeds : undefined,
				});
			} else if (hasText) {
				const chunks = splitMessage(finalText);
				for (let i = 0; i < chunks.length; i++) {
					await (message.channel as any).send({
						content: chunks[i],
						embeds: i === 0 && hasEmbeds ? embeds : undefined,
					});
				}
			} else {
				await (message.channel as any).send({ embeds });
			}
		}

		// Fire-and-forget: extract memories and knowledge from this exchange
		fireMemoryExtraction(username, userId, content, rawResponse);

	} catch (error: any) {
		logger.error(`AI response error: ${error.message}`);

		// Only show error to user if it seems like a connectivity issue
		if (error.message.includes('Failed to reach') || error.message.includes('timed out')) {
			await message.reply({
				content: '*(having trouble thinking right now, try again in a sec)*',
				allowedMentions: { repliedUser: false },
			}).catch(() => {});
		}
	}
};

function fireMemoryExtraction(username: string, userId: string, content: string, rawResponse: string) {
	// Extract personal memories about the user
	extractMemories(username, content, rawResponse).then(notes => {
		if (notes.length > 0) {
			addNotes(userId, notes);
			logger.info(`Learned ${notes.length} thing(s) about ${username}: ${notes.join(', ')}`);
		}
	}).catch(() => {});

	// Extract corrections, server lore, and general knowledge
	extractLearning(username, content, rawResponse).then(facts => {
		if (facts.length > 0) {
			addFacts(facts, username);
			logger.info(`Knowledge base update from ${username}: ${facts.map(f => `[${f.category}] ${f.fact}`).join(', ')}`);
		}
	}).catch(() => {});
}

function splitMessage(text: string, maxLength = 2000): string[] {
	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining);
			break;
		}

		// Try to split at a newline or space
		let splitAt = remaining.lastIndexOf('\n', maxLength);
		if (splitAt === -1 || splitAt < maxLength / 2) {
			splitAt = remaining.lastIndexOf(' ', maxLength);
		}
		if (splitAt === -1 || splitAt < maxLength / 2) {
			splitAt = maxLength;
		}

		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).trimStart();
	}

	return chunks;
}

function buildBridgeUserId(botId: string, username: string): string {
	return `bridge:${botId}:${encodeURIComponent(username.toLowerCase())}`;
}

function parseBridgedMessage(content: string): { rank: string; username: string; content: string } | null {
	const match = content.match(/^\s*(.+?)\s*•\s*(.+?)\s*►\s*([\s\S]+)$/u);
	if (!match) return null;

	const rank = match[1].trim();
	const username = match[2].trim();
	const messageContent = match[3].trim();
	if (!username || !messageContent) return null;

	return { rank, username, content: messageContent };
}

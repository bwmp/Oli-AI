import { Client, Message, EmbedBuilder, ActivityType } from 'discord.js';
import { generateImages } from '~/services/fal';

export interface ParsedResponse {
	/** The clean text to send (actions stripped out) */
	text: string;
	/** Actions the AI wants to perform */
	actions: Action[];
}

export interface Action {
	type: string;
	params: Record<string, string>;
}

/**
 * All the action tags the AI can use, and the instruction text for the system prompt.
 */
export const ACTION_INSTRUCTIONS = `
You have special abilities in this Discord server. You can perform actions by including special tags in your messages. The tags will be stripped from your message before it's sent - users won't see them. You can include multiple actions in one message. Only use these when it makes sense naturally - don't spam them.

Available actions:

[NICK:name] - Change your own server nickname. Use this if someone asks you to, if you want to for fun, or if you're doing a bit.
Example: "sure i'll change my name lol [NICK:sleepy pookie]"

[REACT:emoji] - React to the user's message with an emoji. Use standard unicode emojis or custom server emojis. You can use multiple reacts.
Example: "that's hilarious [REACT:😂]"
Example: "hmm [REACT:🤔][REACT:👀]"

[GIF:url] - Send a GIF or image. The URL will be posted as a message and Discord will auto-embed it. ONLY use URLs that someone has sent in the conversation. NEVER make up or guess a URL - you don't have access to the internet. If someone shares a tenor/giphy/imgur link, you can reuse that exact URL.
Example: "omg yes [GIF:https://tenor.com/view/some-gif-12345]"
Example: "this is so us [GIF:https://media.tenor.com/xxxxx/mp4]"

[IMAGE:prompt] or [IMAGE:prompt|count] - Generate brand new images with your image model (fal.ai) and send them. Use this when someone asks for art/photos/memes, or when posting an image would genuinely add to the conversation. Keep count low (usually 1).
Example: "bet i got u [IMAGE:a fluffy orange cat wearing sunglasses in pixel art style]"
Example: "here are two versions [IMAGE:cinematic cyberpunk alley at night, rain, neon signs|2]"

[EMBED:title|description|color] - Send a fancy embedded message. Color is optional (hex like ff0000 or name like red/blue/green/purple/orange/pink). Good for when you want to be dramatic, make announcements, show off info, or just be extra. Do NOT use embeds to send GIFs - use [GIF:url] instead.
Example: "[EMBED:hot take|python is just pseudocode that accidentally works|ff6600]"
Example: "check this out [EMBED:fun fact|cats sleep 70% of their lives|purple]"

[EMBED_FIELD:name|value|inline] - Add a field to the most recent embed. inline is optional (true/false). Use after an [EMBED] tag.
Example: "[EMBED:language tier list||blue][EMBED_FIELD:S tier|rust obviously|true][EMBED_FIELD:F tier|java lol|true]"

[EMBED_IMAGE:url] - Add an image to the most recent embed. ONLY use URLs that someone has shared in the conversation. NEVER invent URLs.
Example: "[EMBED:look at this||pink][EMBED_IMAGE:https://i.imgur.com/actual-real-link.jpg]"

[STATUS:type|text] - Change your Discord status/activity. Type can be: playing, watching, listening, competing, streaming.
Example: "hold on [STATUS:playing|with fire]"
Example: "[STATUS:watching|you sleep]"

[REPLY:off] - Send your message as a regular message instead of a reply. Use when you're chiming in to a conversation naturally and a reply would feel forced.
Example: "oh wait i know this one [REPLY:off]"

Rules for actions:
- You can combine text with actions. The text will be sent and actions will be executed silently.
- If your entire message is just actions with no text, that's fine too (like if you just want to react).
- Don't overdo embeds - use them when it's actually cool or funny, not every message.
- Don't change your nickname constantly, only when there's a reason (someone asked, a joke, a bit, etc).
- Status changes are fun but don't spam them either.
- You can react to things without saying anything if the vibe calls for it.
- Image generation costs API money, so use [IMAGE:...] only when it makes sense.
- NEVER invent, guess, or fabricate URLs. You do not have internet access. You can only reuse URLs that someone has already shared in the conversation. If someone asks you to send a gif and nobody has shared one, just say you don't have one.
- When someone shares a link (tenor, giphy, imgur, etc.) and asks you to send it or repost it, use [GIF:exact_url_they_sent].
`.trim();

// Color name to hex mapping
const COLOR_MAP: Record<string, number> = {
	red: 0xff0000,
	green: 0x00ff00,
	blue: 0x0088ff,
	purple: 0x9b59b6,
	orange: 0xff8800,
	pink: 0xff69b4,
	yellow: 0xffcc00,
	white: 0xffffff,
	black: 0x000000,
	cyan: 0x00ffff,
	teal: 0x1abc9c,
	gold: 0xffd700,
};

/**
 * Parse an AI response to extract action tags and clean text.
 */
export function parseActions(rawResponse: string): ParsedResponse {
	const actions: Action[] = [];
	let text = rawResponse;

	// Parse [NICK:name]
	text = text.replace(/\[NICK:([^\]]+)\]/gi, (_, name) => {
		actions.push({ type: 'nick', params: { name: name.trim() } });
		return '';
	});

	// Parse [REACT:emoji]
	text = text.replace(/\[REACT:([^\]]+)\]/gi, (_, emoji) => {
		actions.push({ type: 'react', params: { emoji: emoji.trim() } });
		return '';
	});

	// Parse [GIF:url]
	text = text.replace(/\[GIF:([^\]]+)\]/gi, (_, url) => {
		actions.push({ type: 'gif', params: { url: url.trim() } });
		return '';
	});

	// Parse [IMAGE:prompt] or [IMAGE:prompt|count]
	text = text.replace(/\[IMAGE:([^\]]+)\]/gi, (_, content) => {
		const parts = content.split('|');
		actions.push({
			type: 'image',
			params: {
				prompt: (parts[0] || '').trim(),
				count: (parts[1] || '1').trim(),
			},
		});
		return '';
	});

	// Parse [EMBED:title|description|color]
	text = text.replace(/\[EMBED:([^\]]*)\]/gi, (_, content) => {
		const parts = content.split('|');
		actions.push({
			type: 'embed',
			params: {
				title: (parts[0] || '').trim(),
				description: (parts[1] || '').trim(),
				color: (parts[2] || '').trim(),
			},
		});
		return '';
	});

	// Parse [EMBED_FIELD:name|value|inline]
	text = text.replace(/\[EMBED_FIELD:([^\]]*)\]/gi, (_, content) => {
		const parts = content.split('|');
		actions.push({
			type: 'embed_field',
			params: {
				name: (parts[0] || '').trim(),
				value: (parts[1] || '').trim(),
				inline: (parts[2] || 'false').trim(),
			},
		});
		return '';
	});

	// Parse [EMBED_IMAGE:url]
	text = text.replace(/\[EMBED_IMAGE:([^\]]+)\]/gi, (_, url) => {
		actions.push({ type: 'embed_image', params: { url: url.trim() } });
		return '';
	});

	// Parse [STATUS:type|text]
	text = text.replace(/\[STATUS:([^\]]*)\]/gi, (_, content) => {
		const parts = content.split('|');
		actions.push({
			type: 'status',
			params: {
				activityType: (parts[0] || 'playing').trim().toLowerCase(),
				text: (parts[1] || '').trim(),
			},
		});
		return '';
	});

	// Parse [REPLY:off]
	text = text.replace(/\[REPLY:off\]/gi, () => {
		actions.push({ type: 'reply_off', params: {} });
		return '';
	});

	// Clean up extra whitespace from removed tags
	text = text.replace(/\n{3,}/g, '\n\n').trim();

	return { text, actions };
}

/**
 * Resolve a color string to a numeric color value.
 */
function resolveColor(color: string): number | undefined {
	if (!color) return 0x5865F2; // Discord blurple default
	const lower = color.toLowerCase();
	if (COLOR_MAP[lower] !== undefined) return COLOR_MAP[lower];
	// Try hex
	const hex = color.replace('#', '');
	const parsed = parseInt(hex, 16);
	return isNaN(parsed) ? 0x5865F2 : parsed;
}

/**
 * Execute all parsed actions against Discord.
 * Returns info about whether reply mode should be overridden.
 */
export async function executeActions(
	actions: Action[],
	client: Client,
	message: Message,
): Promise<{ forceNoReply: boolean; embeds: EmbedBuilder[]; gifs: string[]; images: string[] }> {
	let forceNoReply = false;
	const embeds: EmbedBuilder[] = [];
	const gifs: string[] = [];
	const images: string[] = [];
	const maxImagesPerResponse = Math.max(1, Math.min(parseInt(process.env.AI_MAX_IMAGES_PER_RESPONSE || '1', 10), 4));
	let currentEmbed: EmbedBuilder | null = null;

	for (const action of actions) {
		try {
			switch (action.type) {
			case 'nick': {
				const me = message.guild?.members.me;
				if (me) {
					await me.setNickname(action.params.name || null);
					logger.info(`AI changed nickname to: ${action.params.name}`);
				}
				break;
			}

			case 'react': {
				try {
					await message.react(action.params.emoji);
				} catch {
					// Emoji might not exist or bot lacks permission
					logger.warn(`Failed to react with: ${action.params.emoji}`);
				}
				break;
			}

			case 'embed': {
				currentEmbed = new EmbedBuilder();
				if (action.params.title) currentEmbed.setTitle(action.params.title);
				if (action.params.description) currentEmbed.setDescription(action.params.description);
				currentEmbed.setColor(resolveColor(action.params.color) ?? 0x5865F2);
				embeds.push(currentEmbed);
				break;
			}

			case 'embed_field': {
				if (currentEmbed) {
					currentEmbed.addFields({
						name: action.params.name || '\u200b',
						value: action.params.value || '\u200b',
						inline: action.params.inline === 'true',
					});
				}
				break;
			}

			case 'embed_image': {
				if (currentEmbed && action.params.url) {
					currentEmbed.setImage(action.params.url);
				}
				break;
			}

			case 'status': {
				const typeMap: Record<string, ActivityType> = {
					playing: ActivityType.Playing,
					watching: ActivityType.Watching,
					listening: ActivityType.Listening,
					competing: ActivityType.Competing,
					streaming: ActivityType.Streaming,
				};
				const actType = typeMap[action.params.activityType] ?? ActivityType.Playing;
				client.user?.setActivity(action.params.text, { type: actType });
				logger.info(`AI changed status to: ${action.params.activityType} ${action.params.text}`);
				break;
			}

			case 'gif': {
				// Validate it's a real URL before adding
				const url = action.params.url;
				if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
					gifs.push(url);
				} else {
					logger.warn(`AI tried to send invalid GIF URL: ${url}`);
				}
				break;
			}

			case 'image': {
				if (images.length >= maxImagesPerResponse) break;

				const prompt = action.params.prompt?.trim();
				if (!prompt) break;

				const requestedCount = Math.max(1, Math.min(parseInt(action.params.count || '1', 10), 4));
				const remaining = maxImagesPerResponse - images.length;
				const count = Math.min(requestedCount, remaining);

				const prefix = (process.env.AI_IMAGE_PROMPT_PREFIX || '').trim();
				const finalPrompt = prefix ? `${prefix}, ${prompt}` : prompt;

				const urls = await generateImages(finalPrompt, count);
				if (urls.length > 0) {
					images.push(...urls);
					logger.info(`AI generated ${urls.length} image(s) from prompt: ${prompt}`);
				}
				break;
			}

			case 'reply_off': {
				forceNoReply = true;
				break;
			}
			}
		} catch (error: any) {
			logger.warn(`Failed to execute action ${action.type}: ${error.message}`);
		}
	}

	return { forceNoReply, embeds, gifs, images };
}

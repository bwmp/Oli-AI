import { SlashCommandBuilder } from 'discord.js';
import { Command } from '~/types/Objects';
import { chat } from '~/services/ollama';
import { parseActions, executeActions } from '~/services/actions';
import { sanitizeAiOutput } from '~/utils/aiText';
import { touchProfile, buildProfileContext, learnFromMessage } from '~/services/profiles';

export const ai: Command = {
	description: 'Send a one-off message to the AI',
	options: (cmd: SlashCommandBuilder) => {
		cmd.addStringOption(option =>
			option
				.setName('message')
				.setDescription('What do you want to say?')
				.setRequired(true)
		);
	},
		execute: async function (interaction, args) {
		const message = args.get('message')!.value as string;
		const username = interaction.member && 'displayName' in interaction.member
			? (interaction.member.displayName as string)
			: interaction.user.displayName || interaction.user.username;
		const userId = interaction.user.id;

		touchProfile(userId, username);
		learnFromMessage(userId, message);
		const userContext = buildProfileContext(userId);

		try {
			const channelName = interaction.channel && 'name' in interaction.channel
				? String((interaction.channel as { name: string }).name)
				: undefined;

			const rawResponse = await chat({
				channelId: interaction.channelId,
				channelName,
				username,
				userId,
				message,
				userContext,
			});
			const { text, actions } = parseActions(rawResponse);
			const cleanedText = sanitizeAiOutput(text, process.env.AI_NAME || interaction.client.user?.displayName || 'Pookie');

			const { embeds: embedBuilders, gifs, images } = await executeActions(
				actions.filter(a => a.type !== 'react' && a.type !== 'reply_off'),
				interaction.client,
				{ guild: interaction.guild, react: async () => {} } as any,
			);

			let finalText = cleanedText;
			if (gifs.length > 0) {
				const gifBlock = gifs.join('\n');
				finalText = finalText ? `${finalText}\n${gifBlock}` : gifBlock;
			}
			if (images.length > 0) {
				const imageBlock = images.join('\n');
				finalText = finalText ? `${finalText}\n${imageBlock}` : imageBlock;
			}

			const reply = finalText.length > 2000 ? finalText.slice(0, 1997) + '...' : finalText;
			await interaction.editReply({
				content: reply || undefined,
				embeds: embedBuilders.length > 0 ? embedBuilders : undefined,
			});
		} catch (error: any) {
			logger.error(`/ai command error: ${error.message}`);
			await interaction.editReply('Couldn\'t reach the AI right now. The server might be offline.');
		}
	},
};

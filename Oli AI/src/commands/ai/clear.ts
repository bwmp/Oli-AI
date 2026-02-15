import { Command } from '~/types/Objects';
import { clearHistory, clearAllHistory } from '~/services/ollama';
import { clearAllChannelSummaries, clearChannelSummary } from '~/services/knowledge';
import { SlashCommandBuilder } from 'discord.js';

export const clear: Command = {
	description: 'Clear the AI conversation memory',
  ownerOnly: true,
	options: (cmd: SlashCommandBuilder) => {
		cmd.addBooleanOption(option =>
			option
				.setName('all')
				.setDescription('Clear memory for ALL channels (owner only)')
				.setRequired(false)
		);
	},
		execute: async function (interaction, args) {
		const all = args.get('all')?.value as boolean | undefined;

		if (all) {
			clearAllHistory();
			clearAllChannelSummaries();
			await interaction.editReply('Cleared AI chat history and rolling summaries for all channels.');
		} else {
			clearHistory(interaction.channelId);
			clearChannelSummary(interaction.channelId);
			await interaction.editReply('Cleared AI chat history and rolling summary for this channel.');
		}
	},
};

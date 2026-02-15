import { SlashCommandBuilder } from 'discord.js';
import { Command } from '~/types/Objects';
import { getPersonality, setPersonality } from '~/services/ollama';

export const personality: Command = {
	description: 'View or change the AI personality',
	ownerOnly: true,
	options: (cmd: SlashCommandBuilder) => {
		cmd.addStringOption(option =>
			option
				.setName('prompt')
				.setDescription('The new system prompt / personality (leave empty to view current)')
				.setRequired(false)
		);
	},
	execute: async function (interaction, args) {
		const newPrompt = args.get('prompt')?.value as string | undefined;

		if (newPrompt) {
			setPersonality(newPrompt);
			await interaction.editReply(`Personality updated.\n\n**New prompt:**\n>>> ${newPrompt.slice(0, 1800)}`);
		} else {
			const current = getPersonality();
			await interaction.editReply(`**Current personality:**\n>>> ${current.slice(0, 1900)}`);
		}
	},
};

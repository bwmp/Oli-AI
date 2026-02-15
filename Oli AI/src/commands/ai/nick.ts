import { SlashCommandBuilder } from 'discord.js';
import { Command } from '~/types/Objects';

export const nick: Command = {
	description: 'Set the bot\'s nickname in this server',
	ownerOnly: true,
	options: (cmd: SlashCommandBuilder) => {
		cmd.addStringOption(option =>
			option
				.setName('name')
				.setDescription('The new nickname (leave empty to reset)')
				.setRequired(false)
		);
	},
	execute: async function (interaction, args) {
		const newNick = args.get('name')?.value as string | undefined;

		try {
			const me = interaction.guild?.members.me;
			if (!me) {
				await interaction.editReply('I can\'t find myself in this server somehow.');
				return;
			}

			await me.setNickname(newNick || null);
			await interaction.editReply(newNick ? `Nickname set to **${newNick}**.` : 'Nickname reset.');
		} catch (error: any) {
			await interaction.editReply(`Couldn't change nickname: ${error.message}`);
		}
	},
};

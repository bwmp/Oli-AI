import { Command } from '~/types/Objects';

export const ping: Command = {
	description: "Pong!",
	execute: function (interaction, args) {
		const initialTime = interaction.createdTimestamp;
		const endTime = Date.now();
		const ping = endTime - initialTime
		interaction.editReply(`Pong! ${ping}ms`);
	}
}
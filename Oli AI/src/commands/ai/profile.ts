import { SlashCommandBuilder } from 'discord.js';
import { Command } from '~/types/Objects';
import { getProfile, getAllProfiles, deleteProfile, setKnownName } from '~/services/profiles';

export const profile: Command = {
	description: 'View what the AI remembers about someone',
	options: (cmd: SlashCommandBuilder) => {
		cmd.addUserOption(option =>
			option
				.setName('user')
				.setDescription('The user to look up (defaults to yourself)')
				.setRequired(false)
		);
		cmd.addStringOption(option =>
			option
				.setName('nickname')
				.setDescription('Set a nickname the AI will know this person by')
				.setRequired(false)
		);
		cmd.addBooleanOption(option =>
			option
				.setName('delete')
				.setDescription('Delete this user\'s profile (owner only)')
				.setRequired(false)
		);
	},
	execute: async function (interaction, args) {
		const targetUser = args.get('user')?.user || interaction.user;
		const nickname = args.get('nickname')?.value as string | undefined;
		const doDelete = args.get('delete')?.value as boolean | undefined;

		if (doDelete) {
			const isOwner = process.env.OWNERIDS?.split(',').includes(interaction.user.id);
			if (!isOwner) {
				await interaction.editReply('Only the bot owner can delete profiles.');
				return;
			}
			const deleted = deleteProfile(targetUser.id);
			await interaction.editReply(deleted ? `Deleted profile for ${targetUser.displayName}.` : 'No profile found.');
			return;
		}

		if (nickname) {
			setKnownName(targetUser.id, nickname);
			await interaction.editReply(`Got it, I'll remember ${targetUser.displayName} as **${nickname}**.`);
			return;
		}

		const allProfiles = getAllProfiles();
		const p = allProfiles.get(targetUser.id);

		if (!p) {
			await interaction.editReply(`I don't know anything about ${targetUser.displayName} yet.`);
			return;
		}

		const lines: string[] = [
			`**Profile: ${p.knownName}** (${p.displayName})`,
			`First seen: <t:${Math.floor(new Date(p.firstSeen).getTime() / 1000)}:R>`,
			`Last seen: <t:${Math.floor(new Date(p.lastSeen).getTime() / 1000)}:R>`,
			`Messages: ${p.messageCount}`,
		];

		if (p.notes.length > 0) {
			lines.push('', '**Memories:**');
			for (const note of p.notes) {
				lines.push(`- ${note}`);
			}
		} else {
			lines.push('', '*No memories yet.*');
		}

		if (p.memoryCard) {
			const hasCardData = p.memoryCard.likes.length > 0 || p.memoryCard.dislikes.length > 0 || p.memoryCard.preferences.length > 0 || p.memoryCard.context.length > 0;
			if (hasCardData) {
				lines.push('', '**Memory Card:**');
				if (p.memoryCard.likes.length > 0) lines.push(`- Likes: ${p.memoryCard.likes.join(', ')}`);
				if (p.memoryCard.dislikes.length > 0) lines.push(`- Dislikes: ${p.memoryCard.dislikes.join(', ')}`);
				if (p.memoryCard.preferences.length > 0) lines.push(`- Preferences: ${p.memoryCard.preferences.join(', ')}`);
				if (p.memoryCard.context.length > 0) lines.push(`- Running context: ${p.memoryCard.context.join(', ')}`);
			}
		}

		await interaction.editReply(lines.join('\n'));
	},
};

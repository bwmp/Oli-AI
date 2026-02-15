import { SlashCommandBuilder } from 'discord.js';
import { Command } from '~/types/Objects';
import { getFacts, deleteFact, clearFacts, getChannelSummary } from '~/services/knowledge';

export const knowledge: Command = {
	description: 'View what the AI has learned over time',
	options: (cmd: SlashCommandBuilder) => {
		cmd.addStringOption(option =>
			option
				.setName('category')
				.setDescription('Filter by category')
				.setRequired(false)
				.addChoices(
					{ name: 'Corrections', value: 'correction' },
					{ name: 'Server Lore', value: 'server_lore' },
					{ name: 'Inside Jokes', value: 'inside_joke' },
					{ name: 'General', value: 'general' },
					{ name: 'Preferences', value: 'preference' },
					{ name: 'Channel Summary', value: '_summary' },
				)
		);
		cmd.addIntegerOption(option =>
			option
				.setName('delete')
				.setDescription('Delete a fact by its number (owner only)')
				.setRequired(false)
		);
		cmd.addBooleanOption(option =>
			option
				.setName('clear_all')
				.setDescription('Clear all learned knowledge (owner only)')
				.setRequired(false)
		);
	},
	execute: async function (interaction, args) {
		const category = args.get('category')?.value as string | undefined;
		const deleteIdx = args.get('delete')?.value as number | undefined;
		const doClear = args.get('clear_all')?.value as boolean | undefined;

		const isOwner = process.env.OWNERIDS?.split(',').includes(interaction.user.id);

		// Delete a specific fact
		if (deleteIdx !== undefined) {
			if (!isOwner) {
				await interaction.editReply('Only the bot owner can delete knowledge entries.');
				return;
			}
			const success = deleteFact(deleteIdx - 1); // Display is 1-indexed
			await interaction.editReply(success ? `Deleted entry #${deleteIdx}.` : 'Invalid entry number.');
			return;
		}

		// Clear all
		if (doClear) {
			if (!isOwner) {
				await interaction.editReply('Only the bot owner can clear all knowledge.');
				return;
			}
			clearFacts();
			await interaction.editReply('Cleared all learned knowledge.');
			return;
		}

		// Show channel summary
		if (category === '_summary') {
			const summary = getChannelSummary(interaction.channelId);
			if (!summary) {
				await interaction.editReply('No conversation summary for this channel yet.');
				return;
			}
			const lines = [
				'**Channel Conversation Summary**',
				`Last updated: <t:${Math.floor(new Date(summary.updatedAt).getTime() / 1000)}:R>`,
				`Messages summarized: ${summary.messageCount}`,
				'',
				summary.summary.slice(0, 1800),
			];
			await interaction.editReply(lines.join('\n'));
			return;
		}

		// Show facts
		const facts = getFacts(category);

		if (facts.length === 0) {
			await interaction.editReply(category
				? `No knowledge in category "${category}" yet.`
				: 'Haven\'t learned anything yet. Give it time.'
			);
			return;
		}

		const categoryEmoji: Record<string, string> = {
			correction: '(corrected)',
			server_lore: '(lore)',
			inside_joke: '(joke)',
			general: '(learned)',
			preference: '(preference)',
		};

		const lines = [`**Learned Knowledge** (${facts.length} entries)${category ? ` - ${category}` : ''}\n`];

		// Show up to 25 facts to fit in Discord's limit
		const display = facts.slice(0, 25);
		for (let i = 0; i < display.length; i++) {
			const f = display[i];
			const tag = categoryEmoji[f.category] || '';
			const reinforced = f.reinforced > 0 ? ` (x${f.reinforced + 1})` : '';
			lines.push(`**${i + 1}.** ${f.fact} ${tag}${reinforced}`);
		}

		if (facts.length > 25) {
			lines.push(`\n*...and ${facts.length - 25} more*`);
		}

		const output = lines.join('\n');
		await interaction.editReply(output.slice(0, 2000));
	},
};

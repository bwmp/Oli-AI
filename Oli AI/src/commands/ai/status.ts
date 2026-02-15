import { Command } from '~/types/Objects';
import { healthCheck, getHistory } from '~/services/ollama';

export const status: Command = {
	description: 'Check if the AI server is online and see available models',
		execute: async function (interaction) {
		const health = await healthCheck();
		const historySize = getHistory(interaction.channelId).length;
		const numCtx = parseInt(process.env.OLLAMA_NUM_CTX || '8192', 10);
		const temp = parseFloat(process.env.OLLAMA_TEMPERATURE || '0.7');
		const topP = parseFloat(process.env.OLLAMA_TOP_P || '0.9');

		if (health.ok) {
			const modelList = health.models?.join(', ') || 'none found';
			const currentModel = process.env.OLLAMA_MODEL || 'mistral-nemo';
			const host = process.env.OLLAMA_HOST || 'http://localhost:11434';

			await interaction.editReply(
				`**AI Server Status**\n` +
				`Server: \`${host}\` - Online\n` +
				`Active model: \`${currentModel}\`\n` +
				`num_ctx: \`${numCtx}\` | temp: \`${temp}\` | top_p: \`${topP}\`\n` +
				`Available models: ${modelList}\n` +
				`Channel memory: ${historySize} messages`
			);
		} else {
			await interaction.editReply(
				`**AI Server Status**\n` +
				`Server: Offline\n` +
				`Error: ${health.error}`
			);
		}
	},
};

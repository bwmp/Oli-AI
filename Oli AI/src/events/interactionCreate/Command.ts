import { Client, CommandInteraction, MessageFlags } from "discord.js";
import commands from "~/lists/commands";

export default async (client: Client, interaction: CommandInteraction) => {

    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    const args = interaction.options;
    await interaction.deferReply({ 
        flags: command.ephemeral ? [MessageFlags.Ephemeral] : undefined
    });

    if (command.ownerOnly && process.env.OWNERID?.split(",").includes(interaction.member!.user.id)) {
        return interaction.editReply({ content: "This command can only be used by the bot creator" })
    }
    try {
        await command.execute(interaction, args);
    } catch (error) {
        console.error(error);
        await interaction.editReply({ content: 'There was an error while executing this command!' });
    }
}
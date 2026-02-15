import { Client } from "discord.js";
import { loadProfiles } from "~/services/profiles";
import { loadKnowledge } from "~/services/knowledge";

export default async (client: Client<true>) =>{
    loadProfiles();
    loadKnowledge();
    logger.info(`Logged in as ${client.user.tag}!`);
    logger.info(`Guilds: ${client.guilds.cache.size}`)
}
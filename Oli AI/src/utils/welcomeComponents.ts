import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';

type WelcomeComponentOptions = {
  userId: string;
  guildName: string;
  rulesChannelId?: string;
  introChannelId?: string;
  rolesChannelId?: string;
  heroImageUrl?: string | null;
};

export const buildWelcomeComponents = ({
  userId,
  guildName,
  rulesChannelId,
  introChannelId,
  rolesChannelId,
  heroImageUrl,
}: WelcomeComponentOptions) => {
  const container = new ContainerBuilder().setAccentColor(0x22c55e);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Welcome to **${guildName}**!`),
    new TextDisplayBuilder().setContent(
      `Hey <@${userId}>! We are glad you are here.`,
    ),
  );

  if (heroImageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(heroImageUrl),
      ),
    );
  }

  const details: string[] = [];
  if (rulesChannelId) {
    details.push(`Please read <#${rulesChannelId}> first. ${rolesChannelId ? `Then check out the roles in <#${rolesChannelId}>.` : ''}`);
  }
  if (introChannelId) {
    details.push(`When you are ready, say hi in <#${introChannelId}>.`);
  }

  if (details.length) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(details.join('\n')),
    );
  }

  return [container];
};

import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';

type LeaveComponentOptions = {
  userId: string;
  username: string;
  guildName: string;
  memberCount: number;
  heroImageUrl?: string | null;
};

export const buildLeaveComponents = ({
  userId,
  username,
  guildName,
  memberCount,
  heroImageUrl,
}: LeaveComponentOptions) => {
  const container = new ContainerBuilder().setAccentColor(0xef4444);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${username} left **${guildName}**`),
    new TextDisplayBuilder().setContent(
      `Goodbye <@${userId}>. We hope to see you again.`,
    ),
  );

  if (heroImageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(heroImageUrl),
      ),
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `We are now at **${memberCount}** members.`,
    ),
  );

  return [container];
};

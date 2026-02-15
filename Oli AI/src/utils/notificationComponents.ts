import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';

export type WebhookResource = {
  id?: number;
  title?: string;
  creator?: string;
  url?: string;
  category?: string;
  imageUrl?: string | null;
  description?: string | null;
};

export type WebhookReport = {
  reason?: string;
  details?: string | null;
  reporter?: string;
};

export type WebhookSubmitter = {
  name?: string | null;
};

export type WebhookNotification = {
  type?: string;
  resource?: WebhookResource;
  report?: WebhookReport;
  submitter?: WebhookSubmitter;
};

export const buildNotificationComponents = (
  notification: WebhookNotification,
) => {
  const typeKey = notification.type === 'approval' ? 'published' : notification.type;
  const config = {
    report: { title: 'Resource reported', color: 0xef4444 },
    submission: { title: 'New resource submission', color: 0x3b82f6 },
    published: { title: 'Resource published', color: 0x22c55e },
    featured: { title: 'Resource featured', color: 0xf59e0b },
  } as const;

  const resource = notification.resource;
  const container = new ContainerBuilder();
  const accent = config[typeKey as keyof typeof config]?.color;
  if (accent) {
    container.setAccentColor(accent);
  }

  const header = new TextDisplayBuilder().setContent(
    `**${config[typeKey as keyof typeof config]?.title ?? 'Resource update'}**`,
  );

  if (resource?.imageUrl) {
    const gallery = new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(resource.imageUrl),
    );
    container.addMediaGalleryComponents(gallery);
  }

  const summary: string[] = [];
  if (resource?.title) {
    summary.push(`**${resource.title}**`);
  }
  if (resource?.creator) {
    summary.push(`Creator: ${resource.creator}`);
  }
  if (resource?.category) {
    summary.push(`Category: ${resource.category}`);
  }
  if (resource?.url) {
    summary.push(`Link: ${resource.url}`);
  }

  if (summary.length) {
    container.addTextDisplayComponents(
      header,
      new TextDisplayBuilder().setContent(summary.join('\n')),
    );
  } else {
    container.addTextDisplayComponents(header);
  }

  if (resource?.description) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(resource.description),
    );
  }

  if (notification.submitter?.name) {
    const label = notification.submitter?.name || "Anonymous";
    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`Submitted by: ${label}`),
    );
  }

  if (notification.report?.reason || notification.report?.details || notification.report?.reporter) {
    const reportLines: string[] = [];
    if (notification.report?.reason) {
      reportLines.push(`Reason: ${notification.report.reason}`);
    }
    if (notification.report?.details) {
      reportLines.push(`Details: ${notification.report.details}`);
    }
    if (notification.report?.reporter) {
      reportLines.push(`Reported by: ${notification.report.reporter}`);
    }
    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(reportLines.join('\n')),
    );
  }

  if (resource?.url) {
    const linkSection = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('Open resource'))
      .setButtonAccessory(
        new ButtonBuilder()
          .setLabel('Open resource')
          .setURL(resource.url)
          .setStyle(ButtonStyle.Link),
      );
    container.addSectionComponents(linkSection);
  }

  return [container];
};

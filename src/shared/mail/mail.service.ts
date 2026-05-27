import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import {
  buildTicketInvitationEmail,
  buildMassSignupAlertEmail,
  type TicketInvitationLinks,
} from './templates';

// TODO(MAIL-001): replace the App Store placeholder once the app is published
// (OPS-001) and the `allons.app` domain serves apple-app-site-association +
// assetlinks.json. All four are env-overridable so prod can be wired without a
// code change.
export const APP_STORE_LINK =
  process.env.MAIL_APP_STORE_LINK ?? 'https://apps.apple.com/app/id000000000';
export const PLAY_STORE_LINK =
  process.env.MAIL_PLAY_STORE_LINK ??
  'https://play.google.com/store/apps/details?id=com.fndrs.allons';
export const DEEP_LINK_TICKETS =
  process.env.MAIL_DEEP_LINK_TICKETS ?? 'allons://tickets';
export const WEB_FALLBACK_TICKETS =
  process.env.MAIL_WEB_FALLBACK_TICKETS ?? 'https://allons.app/tickets';

export interface InviteEmailPayload {
  to: string;
  inviterName: string;
  eventTitle: string;
  ticketId?: string | null;
  isAllonsUser: boolean;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY ?? '';
    this.from = process.env.MAIL_FROM ?? 'Allons <no-reply@allons.app>';
    // No API key → keep the local/dev behavior: log only, never send. This
    // mirrors how PostHogService degrades gracefully when unconfigured.
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendTicketInvitation(payload: InviteEmailPayload) {
    const ticketDeepLink = payload.ticketId
      ? `${DEEP_LINK_TICKETS}/${payload.ticketId}`
      : DEEP_LINK_TICKETS;
    const ticketWebLink = payload.ticketId
      ? `${WEB_FALLBACK_TICKETS}/${payload.ticketId}`
      : WEB_FALLBACK_TICKETS;

    const links: TicketInvitationLinks = {
      ticketDeepLink,
      ticketWebLink,
      appStoreLink: APP_STORE_LINK,
      playStoreLink: PLAY_STORE_LINK,
    };

    const { subject, html, text } = buildTicketInvitationEmail(
      {
        to: payload.to,
        inviterName: payload.inviterName,
        eventTitle: payload.eventTitle,
        isAllonsUser: payload.isAllonsUser,
      },
      links,
    );

    const deepLink = payload.isAllonsUser ? ticketDeepLink : null;

    // Operational hints only — never the recipient email or inviter name.
    const opHints = `isAllonsUser=${payload.isAllonsUser} hasTicketId=${Boolean(
      payload.ticketId,
    )}`;

    if (!this.resend) {
      this.logger.log(`[mail] invite logged (no provider) ${opHints}`);
      return {
        delivered: true,
        id: null as string | null,
        to: payload.to,
        subject,
        previewText: text,
        deepLink,
      };
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to: payload.to,
        subject,
        html,
        text,
      });

      if (error) {
        this.logger.error(
          `[mail] invite send failed (${error.name}) ${opHints}`,
        );
        return {
          delivered: false,
          id: null as string | null,
          to: payload.to,
          subject,
          previewText: text,
          deepLink,
        };
      }

      this.logger.log(
        `[mail] invite sent id=${data?.id ?? 'unknown'} ${opHints}`,
      );
      return {
        delivered: true,
        id: data?.id ?? null,
        to: payload.to,
        subject,
        previewText: text,
        deepLink,
      };
    } catch (err) {
      this.logger.error(
        `[mail] invite send threw: ${
          err instanceof Error ? err.message : 'unknown error'
        } ${opHints}`,
      );
      return {
        delivered: false,
        id: null as string | null,
        to: payload.to,
        subject,
        previewText: text,
        deepLink,
      };
    }
  }

  async sendMassSignupAlert(payload: {
    to: string[];
    count: number;
    windowMinutes: number;
    threshold: number;
  }) {
    const { subject, html, text } = buildMassSignupAlertEmail({
      count: payload.count,
      windowMinutes: payload.windowMinutes,
      threshold: payload.threshold,
    });

    const opHints = `count=${payload.count} window=${payload.windowMinutes}m threshold=${payload.threshold}`;

    if (!this.resend) {
      this.logger.warn(
        `[mail] mass-signup alert logged (no provider) ${opHints}`,
      );
      return false;
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.from,
        to: payload.to,
        subject,
        html,
        text,
      });
      if (error) {
        this.logger.error(
          `[mail] mass-signup alert send failed (${error.name}) ${opHints}`,
        );
        return false;
      }

      this.logger.log(`[mail] mass-signup alert sent ${opHints}`);
      return true;
    } catch (err) {
      this.logger.error(
        `[mail] mass-signup alert send threw: ${
          err instanceof Error ? err.message : 'unknown error'
        } ${opHints}`,
      );
      return false;
    }
  }
}

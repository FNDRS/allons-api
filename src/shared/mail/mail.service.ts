import { Injectable, Logger } from '@nestjs/common';

export const APP_STORE_LINK = 'https://apps.apple.com/app/id000000000';
export const PLAY_STORE_LINK =
  'https://play.google.com/store/apps/details?id=com.fndrs.allons';
export const DEEP_LINK_TICKETS = 'allons://tickets';
export const WEB_FALLBACK_TICKETS = 'https://allons.app/tickets';

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

  async sendTicketInvitation(payload: InviteEmailPayload) {
    await Promise.resolve();
    const ticketDeepLink = payload.ticketId
      ? `${DEEP_LINK_TICKETS}/${payload.ticketId}`
      : DEEP_LINK_TICKETS;
    const ticketWebLink = payload.ticketId
      ? `${WEB_FALLBACK_TICKETS}/${payload.ticketId}`
      : WEB_FALLBACK_TICKETS;

    const subject = payload.isAllonsUser
      ? 'Tienes una invitación en Allons'
      : `${payload.inviterName} te invita a un evento`;

    const body = payload.isAllonsUser
      ? [
          `Hola,`,
          ``,
          `${payload.inviterName} te invitó a "${payload.eventTitle}".`,
          `Puedes revisar tu invitación en la app de Allons.`,
          ``,
          `Abrir en la app: ${ticketDeepLink}`,
          `Si no abre automáticamente, visita: ${ticketWebLink}`,
        ].join('\n')
      : [
          `Hola,`,
          ``,
          `${payload.inviterName} te invitó al evento "${payload.eventTitle}" usando Allons.`,
          `Para ver tu invitación, instala Allons:`,
          ``,
          `App Store: ${APP_STORE_LINK}`,
          `Google Play: ${PLAY_STORE_LINK}`,
          ``,
          `Después de instalar, inicia sesión con este correo (${payload.to}) para ver tu ticket.`,
        ].join('\n');

    this.logger.log(
      `[mail] -> ${payload.to} | ${subject}\n${body}\n--- end mail ---`,
    );

    return {
      delivered: true,
      to: payload.to,
      subject,
      previewText: body,
      deepLink: payload.isAllonsUser ? ticketDeepLink : null,
    };
  }
}

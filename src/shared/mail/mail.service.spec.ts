import {
  APP_STORE_LINK,
  DEEP_LINK_TICKETS,
  MailService,
  PLAY_STORE_LINK,
  WEB_FALLBACK_TICKETS,
} from './mail.service';

describe('MailService', () => {
  it('builds deep link when recipient is Allons user', async () => {
    const service = new MailService();
    const res = await service.sendTicketInvitation({
      to: 'a@b.com',
      inviterName: 'Ana',
      eventTitle: 'Fiesta',
      ticketId: 't1',
      isAllonsUser: true,
    });
    expect(res.delivered).toBe(true);
    expect(res.deepLink).toBe(`${DEEP_LINK_TICKETS}/t1`);
    expect(res.previewText).toContain(`${WEB_FALLBACK_TICKETS}/t1`);
  });

  it('builds store links when recipient is not Allons user', async () => {
    const service = new MailService();
    const res = await service.sendTicketInvitation({
      to: 'x@y.com',
      inviterName: 'Luis',
      eventTitle: 'Evento',
      ticketId: null,
      isAllonsUser: false,
    });
    expect(res.deepLink).toBeNull();
    expect(res.previewText).toContain(APP_STORE_LINK);
    expect(res.previewText).toContain(PLAY_STORE_LINK);
  });
});

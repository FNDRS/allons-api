import { buildTicketInvitationEmail } from './templates';

const links = {
  ticketDeepLink: 'allons://tickets/t1',
  ticketWebLink: 'https://allons.app/tickets/t1',
  appStoreLink: 'https://apps.apple.com/app/id000000000',
  playStoreLink:
    'https://play.google.com/store/apps/details?id=com.fndrs.allons',
};

describe('buildTicketInvitationEmail', () => {
  it('renders an HTML CTA to the deep link for Allons users', () => {
    const email = buildTicketInvitationEmail(
      {
        to: 'a@b.com',
        inviterName: 'Ana',
        eventTitle: 'Fiesta',
        isAllonsUser: true,
      },
      links,
    );
    expect(email.subject).toBe('Tienes una invitación en Allons');
    expect(email.html).toContain(`href="${links.ticketDeepLink}"`);
    expect(email.html).toContain(`href="${links.ticketWebLink}"`);
    // Plain-text fallback keeps the links for clients that strip HTML.
    expect(email.text).toContain(links.ticketDeepLink);
    expect(email.text).toContain(links.ticketWebLink);
  });

  it('renders store buttons in HTML and text for non-Allons users', () => {
    const email = buildTicketInvitationEmail(
      {
        to: 'x@y.com',
        inviterName: 'Luis',
        eventTitle: 'Evento',
        isAllonsUser: false,
      },
      links,
    );
    expect(email.subject).toBe('Luis te invita a un evento');
    expect(email.html).toContain(`href="${links.appStoreLink}"`);
    expect(email.html).toContain(`href="${links.playStoreLink}"`);
    expect(email.text).toContain(links.appStoreLink);
    expect(email.text).toContain(links.playStoreLink);
  });

  it('escapes user-provided values in the HTML body', () => {
    const email = buildTicketInvitationEmail(
      {
        to: 'a@b.com',
        inviterName: '<script>x</script>',
        eventTitle: 'Tom & "Jerry"',
        isAllonsUser: true,
      },
      links,
    );
    expect(email.html).not.toContain('<script>x</script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Tom &amp; &quot;Jerry&quot;');
  });
});

/**
 * Email content builders for transactional mail.
 *
 * Each builder returns subject + html + text so the sender can ship a
 * multipart message (HTML for clients that render it, text as fallback and
 * for previews/tests). User-provided values are HTML-escaped before going
 * into the HTML body to avoid markup injection.
 */

const BRAND_ORANGE = '#F67010';
const INK = '#131516';
const MUTED = '#6B7280';
const CARD_BG = '#FFFFFF';
const PAGE_BG = '#F3F4F6';

export interface TicketInvitationLinks {
  ticketDeepLink: string;
  ticketWebLink: string;
  appStoreLink: string;
  playStoreLink: string;
}

export interface TicketInvitationParams {
  to: string;
  inviterName: string;
  eventTitle: string;
  isAllonsUser: boolean;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export interface MassSignupAlertParams {
  count: number;
  windowMinutes: number;
  threshold: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(href: string, label: string, primary = true): string {
  const bg = primary ? BRAND_ORANGE : INK;
  return `<a href="${href}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:12px;">${escapeHtml(
    label,
  )}</a>`;
}

/** Wraps body markup in a responsive, email-client-safe shell. */
function layout(innerHtml: string): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:${PAGE_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${CARD_BG};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:${INK};padding:20px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">Allons</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${innerHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;">
                <p style="margin:0;color:${MUTED};font-size:12px;line-height:18px;">Recibiste este correo porque alguien te invitó a un evento en Allons.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildTicketInvitationEmail(
  params: TicketInvitationParams,
  links: TicketInvitationLinks,
): BuiltEmail {
  const inviter = escapeHtml(params.inviterName);
  const event = escapeHtml(params.eventTitle);

  const subject = params.isAllonsUser
    ? 'Tienes una invitación en Allons'
    : `${params.inviterName} te invita a un evento`;

  if (params.isAllonsUser) {
    const text = [
      `Hola,`,
      ``,
      `${params.inviterName} te invitó a "${params.eventTitle}".`,
      `Puedes revisar tu invitación en la app de Allons.`,
      ``,
      `Abrir en la app: ${links.ticketDeepLink}`,
      `Si no abre automáticamente, visita: ${links.ticketWebLink}`,
    ].join('\n');

    const html = layout(`
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;">Hola,</p>
      <p style="margin:0 0 24px;font-size:16px;line-height:24px;">${inviter} te invitó a <strong>"${event}"</strong>. Revisa tu invitación en la app de Allons.</p>
      <p style="margin:0 0 24px;">${button(links.ticketDeepLink, 'Ver invitación')}</p>
      <p style="margin:0;color:${MUTED};font-size:14px;line-height:20px;">¿No se abrió la app? Abre este enlace en tu teléfono:<br /><a href="${links.ticketWebLink}" style="color:${BRAND_ORANGE};">${escapeHtml(links.ticketWebLink)}</a></p>
    `);

    return { subject, html, text };
  }

  const text = [
    `Hola,`,
    ``,
    `${params.inviterName} te invitó al evento "${params.eventTitle}" usando Allons.`,
    `Para ver tu invitación, instala Allons:`,
    ``,
    `App Store: ${links.appStoreLink}`,
    `Google Play: ${links.playStoreLink}`,
    ``,
    `Después de instalar, inicia sesión con este correo (${params.to}) para ver tu ticket.`,
  ].join('\n');

  const html = layout(`
    <p style="margin:0 0 16px;font-size:18px;font-weight:600;">Hola,</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:24px;">${inviter} te invitó al evento <strong>"${event}"</strong> usando Allons. Para ver tu invitación, instala la app:</p>
    <p style="margin:0 0 12px;">${button(links.appStoreLink, 'Descargar en App Store')}</p>
    <p style="margin:0 0 24px;">${button(links.playStoreLink, 'Descargar en Google Play', false)}</p>
    <p style="margin:0;color:${MUTED};font-size:14px;line-height:20px;">Después de instalar, inicia sesión con este correo (<strong>${escapeHtml(
      params.to,
    )}</strong>) para ver tu ticket.</p>
  `);

  return { subject, html, text };
}

export function buildMassSignupAlertEmail(
  params: MassSignupAlertParams,
): BuiltEmail {
  const subject = `Alerta: picos de registros (${params.count} en ${params.windowMinutes} min)`;
  const text = [
    'Alerta Allons',
    '',
    `Detectamos un pico de registros en Supabase Auth: ${params.count} signups en los últimos ${params.windowMinutes} minutos.`,
    `Umbral configurado: ${params.threshold}.`,
    '',
    'Revisa si es tráfico legítimo o abuso (bots).',
  ].join('\n');

  const html = layout(`
    <p style="margin:0 0 16px;font-size:18px;font-weight:600;">Alerta</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:24px;">
      Detectamos un pico de registros en <strong>Supabase Auth</strong>:
      <strong>${params.count}</strong> signups en los últimos <strong>${params.windowMinutes}</strong> minutos.
    </p>
    <p style="margin:0 0 24px;font-size:14px;line-height:20px;color:${MUTED};">
      Umbral configurado: ${params.threshold}. Si esto no es esperado, considera activar rate limiting adicional, captcha o revisar logs.
    </p>
    <p style="margin:0;">${button(
      'https://supabase.com/dashboard/project/_/auth/users',
      'Abrir Auth Users',
    )}</p>
  `);

  return { subject, html, text };
}

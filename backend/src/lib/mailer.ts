/**
 * Envio de correos (RQ63, RQ64). Se configura con variables de entorno, nunca en el codigo. En orden de prioridad:
 *   RQ67 - desde la cuenta de Gmail del administrador, sin servidor ni servicio de correo:
 *   1. GMAIL_USER + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN: API de Gmail por HTTPS (funciona
 *      aunque el servidor bloquee SMTP, como el plan free de Render).
 *   2. GMAIL_USER + GMAIL_APP_PASSWORD: SMTP de Gmail con contrasena de aplicacion (PC local o Render pagado).
 *   Servicios externos:
 *   3. RESEND_API_KEY: API HTTPS de Resend.
 *   4. BREVO_API_KEY : API HTTPS de Brevo.
 *   5. SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true para 465), SMTP_USER, SMTP_PASS.
 * MAIL_FROM es el remitente ("Nombre <correo@dominio>"); con Gmail, por defecto "AcademiaPass <GMAIL_USER>".
 * Sin ninguna opcion el correo no sale: queda en el registro del servidor y en notifications como 'logged'.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

export interface Mail { to: string; subject: string; text: string; html: string }
type Sender = (mail: Mail) => Promise<void>;

let override: Sender | null = null;
let transport: Transporter | null = null;

/** Solo para pruebas: captura los correos en lugar de enviarlos */
export function setMailSender(sender: Sender | null) {
  override = sender;
}

const env = process.env;
const gmailApi = () => !!(env.GMAIL_USER && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);

export type MailProvider = 'test' | 'gmail-api' | 'gmail' | 'resend' | 'brevo' | 'smtp';
export const mailProvider = (): MailProvider | null =>
  override ? 'test'
    : gmailApi() ? 'gmail-api'
    : env.GMAIL_USER && env.GMAIL_APP_PASSWORD ? 'gmail'
    : env.RESEND_API_KEY ? 'resend'
    : env.BREVO_API_KEY ? 'brevo'
    : env.SMTP_HOST ? 'smtp' : null;
export const mailConfigured = () => mailProvider() != null;

/** Cuenta desde la que salen los correos (sin claves), para mostrarla en la app */
export const mailSender = () => {
  const p = mailProvider();
  if (p === 'gmail-api' || p === 'gmail') return env.MAIL_FROM ?? `AcademiaPass <${env.GMAIL_USER}>`;
  return p && p !== 'test' ? env.MAIL_FROM ?? env.SMTP_USER ?? null : null;
};

let gmailToken: { value: string; expires: number } | null = null;

/** Token de acceso de Gmail a partir del refresh token (se renueva un minuto antes de vencer) */
async function gmailAccessToken() {
  if (gmailToken && gmailToken.expires > Date.now() + 60_000) return gmailToken.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID!, client_secret: env.GMAIL_CLIENT_SECRET!, refresh_token: env.GMAIL_REFRESH_TOKEN!, grant_type: 'refresh_token',
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google no entregó el token de Gmail: ${body.error_description ?? body.error ?? res.status}`);
  gmailToken = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return gmailToken.value;
}

/** Envia por la API de Gmail: el mensaje MIME completo va en base64url */
async function sendWithGmailApi(from: string, mail: Mail) {
  const raw = await new MailComposer({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }).compile().build();
  await postJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { authorization: `Bearer ${await gmailAccessToken()}` },
    { raw: Buffer.from(raw).toString('base64url') });
}

/** "Nombre <correo@dominio>" -> { name, email } */
function parseFrom(from: string) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].replace(/^"|"$/g, '') || undefined, email: m[2] } : { name: undefined, email: from.trim() };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export async function sendMail(mail: Mail): Promise<'sent' | 'logged'> {
  if (override) {
    await override(mail);
    return 'sent';
  }
  const provider = mailProvider();
  if (!provider) return 'logged';
  const from = mailSender() ?? '';
  if (provider !== 'smtp' && !from) throw new Error('Falta la variable MAIL_FROM (remitente)');
  if (provider === 'gmail-api') {
    await sendWithGmailApi(from, mail);
    return 'sent';
  }
  if (provider === 'resend') {
    await postJson('https://api.resend.com/emails', { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      { from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html });
    return 'sent';
  }
  if (provider === 'brevo') {
    await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': process.env.BREVO_API_KEY! },
      { sender: parseFrom(from), to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text, htmlContent: mail.html });
    return 'sent';
  }
  if (!transport && provider === 'gmail') {
    transport = nodemailer.createTransport({ service: 'gmail', auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD!.replace(/\s/g, '') }, connectionTimeout: 15_000 });
  }
  if (!transport) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 15_000,
    });
  }
  await transport.sendMail({ from, ...mail });
  return 'sent';
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Arma el texto plano y el HTML a partir de bloques: titulo, parrafos y tablas sencillas */
export function compose(blocks: ({ p: string } | { h: string } | { rows: [string, string][] } | { list: string[]; empty: string } | { link: string; label: string })[], opts: { footer?: boolean } = {}) {
  const text: string[] = [];
  const html: string[] = [];
  for (const b of blocks) {
    if ('p' in b) { text.push(b.p, ''); html.push(`<p>${esc(b.p)}</p>`); }
    if ('h' in b) { text.push(b.h.toUpperCase()); html.push(`<h3 style="margin:16px 0 6px;color:#1d4ed8">${esc(b.h)}</h3>`); }
    if ('rows' in b) {
      for (const [k, v] of b.rows) text.push(`${k}: ${v}`);
      text.push('');
      html.push(`<table style="border-collapse:collapse">${b.rows.map(([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#555">${esc(k)}</td><td style="padding:2px 0"><b>${esc(v)}</b></td></tr>`).join('')}</table>`);
    }
    if ('link' in b) {
      text.push(`${b.label}: ${b.link}`, '');
      html.push(`<p><a href="${esc(b.link)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">${esc(b.label)}</a></p>`);
    }
    if ('list' in b) {
      if (!b.list.length) { text.push(b.empty, ''); html.push(`<p style="color:#555">${esc(b.empty)}</p>`); }
      else { for (const x of b.list) text.push(`- ${x}`); text.push(''); html.push(`<ul>${b.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`); }
    }
  }
  if (opts.footer !== false) {
    text.push('Puedes cambiar qué correos recibes en la app: Mi perfil > Notificaciones por correo.');
    html.push('<p style="color:#888;font-size:12px">Puedes cambiar qué correos recibes en la app: Mi perfil &gt; Notificaciones por correo.</p>');
  }
  return { text: text.join('\n'), html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">${html.join('')}</div>` };
}

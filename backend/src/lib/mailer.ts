/**
 * Envio de correos (RQ63, RQ64) por SMTP. Se configura con variables de entorno, nunca en el codigo:
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true para el puerto 465), SMTP_USER, SMTP_PASS y MAIL_FROM.
 * Sin SMTP_HOST el correo no sale: queda en el registro del servidor y en la tabla notifications como 'logged'.
 */
import nodemailer, { type Transporter } from 'nodemailer';

export interface Mail { to: string; subject: string; text: string; html: string }
type Sender = (mail: Mail) => Promise<void>;

let override: Sender | null = null;
let transport: Transporter | null = null;

/** Solo para pruebas: captura los correos en lugar de enviarlos */
export function setMailSender(sender: Sender | null) {
  override = sender;
}

export const mailConfigured = () => !!process.env.SMTP_HOST || !!override;

export async function sendMail(mail: Mail): Promise<'sent' | 'logged'> {
  if (override) {
    await override(mail);
    return 'sent';
  }
  if (!process.env.SMTP_HOST) return 'logged';
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
  await transport.sendMail({ from: process.env.MAIL_FROM ?? process.env.SMTP_USER, ...mail });
  return 'sent';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Arma el texto plano y el HTML a partir de bloques: titulo, parrafos y tablas sencillas */
export function compose(blocks: ({ p: string } | { h: string } | { rows: [string, string][] } | { list: string[]; empty: string })[]) {
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
    if ('list' in b) {
      if (!b.list.length) { text.push(b.empty, ''); html.push(`<p style="color:#555">${esc(b.empty)}</p>`); }
      else { for (const x of b.list) text.push(`- ${x}`); text.push(''); html.push(`<ul>${b.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`); }
    }
  }
  text.push('Puedes cambiar qué correos recibes en la app: Mi perfil > Notificaciones por correo.');
  html.push('<p style="color:#888;font-size:12px">Puedes cambiar qué correos recibes en la app: Mi perfil &gt; Notificaciones por correo.</p>');
  return { text: text.join('\n'), html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">${html.join('')}</div>` };
}

// Password-reset email via Nodemailer. In dev (no SMTP_HOST), the link is
// logged to the server console instead of being sent.
import nodemailer from 'nodemailer';
import { env, flags } from '../env.js';

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });
  return transporter;
}

export async function sendResetEmail(to, token) {
  const link = `${env.appUrl}/?token=${encodeURIComponent(token)}#reset`;
  if (!flags.hasSMTP) {
    console.log('\n──────────── PASSWORD RESET (dev) ────────────');
    console.log(`  to:    ${to}`);
    console.log(`  link:  ${link}`);
    console.log(`  token: ${token}`);
    console.log('──────────────────────────────────────────────\n');
    return { delivered: false, link };
  }
  await getTransport().sendMail({
    from: env.mailFrom,
    to,
    subject: 'Reset your ShotLab password',
    text: `Reset your password: ${link}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
    html: `<p>Reset your ShotLab password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`,
  });
  return { delivered: true };
}

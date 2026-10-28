import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter = null;
if (config.smtp.host && config.smtp.user) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

export const mailEnabled = () => Boolean(transporter);

/** Send an email if SMTP is configured. Never throws: delivery problems are logged. */
export async function sendMail(to, subject, text) {
  if (!transporter || !to) return false;
  try {
    await transporter.sendMail({ from: config.smtp.from, to, subject, text });
    return true;
  } catch (err) {
    console.error('[mail] failed:', err.message);
    return false;
  }
}

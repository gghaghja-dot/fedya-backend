const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user, pass },
  });
  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  const tx = getTransporter();
  if (!tx) {
    logger.warn('SMTP not configured; email skipped', { to, subject, text });
    return { skipped: true, reason: 'SMTP_USER/SMTP_PASS empty' };
  }
  const info = await tx.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
  logger.info('Email sent', { to, messageId: info.messageId });
  return info;
}

async function sendVerificationEmail(email, code) {
  return sendMail({
    to: email,
    subject: 'FedyaLM — подтверждение email',
    text: `Ваш код подтверждения: ${code}`,
    html: `<p>Ваш код подтверждения: <b>${code}</b></p>`,
  });
}

async function sendPasswordResetEmail(email, token) {
  const link = `${process.env.APP_URL || 'https://fedya-backend-r0sz.onrender.com'}/reset?token=${token}`;
  return sendMail({
    to: email,
    subject: 'FedyaLM — сброс пароля',
    text: `Токен сброса: ${token}\nИли откройте: ${link}`,
    html: `<p>Токен сброса: <code>${token}</code></p><p><a href="${link}">Сбросить пароль</a></p>`,
  });
}

module.exports = {
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
};

/**
 * Email service.
 *
 * If EMAIL_ENABLED=true, uses nodemailer via SMTP.
 * Otherwise, logs the email to the console (dev-friendly).
 */

'use strict';

const nodemailer = require('nodemailer');
const logger = require('../config/logger');

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    if (process.env.EMAIL_ENABLED !== 'true') return null;

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
        auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
    });

    return transporter;
}

/**
 * Send an email; falls back to console in dev.
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 */
async function sendMail({ to, subject, text, html }) {
    const tx = getTransporter();

    if (!tx) {
        logger.info('📧 [DEV EMAIL] (EMAIL_ENABLED=false)');
        logger.info(`   To:      ${to}`);
        logger.info(`   Subject: ${subject}`);
        logger.info(`   Text:    ${text}`);
        return { delivered: false, previewOnly: true };
    }

    const info = await tx.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@realtimechat.local',
        to,
        subject,
        text,
        html: html || `<pre>${text}</pre>`,
    });

    logger.info(`Email sent to ${to} (messageId=${info.messageId})`);
    return { delivered: true, messageId: info.messageId };
}

/**
 * Password reset email.
 */
async function sendPasswordResetEmail({ to, name, resetUrl }) {
    const subject = 'Reset your password';
    const text =
        `Hi ${name},\n\n` +
        `We received a request to reset your password.\n` +
        `Click the link below to choose a new one. This link expires in 30 minutes.\n\n` +
        `${resetUrl}\n\n` +
        `If you did not request this, you can safely ignore this email.\n`;

    return sendMail({ to, subject, text });
}

module.exports = { sendMail, sendPasswordResetEmail };
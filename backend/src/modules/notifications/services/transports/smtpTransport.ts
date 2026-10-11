import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../../../../config';
import { NotificationTransport, TransportMessage, TransportResult } from './index';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
    if (transporter) return transporter;
    const { host, port, secure, user, pass } = config.notifications.smtp;
    if (!host) throw new Error('SMTP_HOST is not configured');

    transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass } : undefined,
    });
    return transporter;
}

export const smtpTransport: NotificationTransport = {
    type: 'email',
    async send(msg: TransportMessage): Promise<TransportResult> {
        if (process.env.E2E_TESTING === 'true') {
            console.log(`[smtpTransport:mock] would send to ${(msg.to ?? []).join(',')} subject="${msg.subject ?? ''}"`);
            return { messageId: 'mock-e2e', provider: 'smtp-mock' };
        }
        const t = getTransporter();
        const fromAddress = msg.fromAddress || config.notifications.fromAddress;
        const fromName = msg.fromName || config.notifications.fromName;
        if (!fromAddress) throw new Error('EMAIL_FROM_ADDRESS is not configured');

        const info = await t.sendMail({
            from: fromName ? `"${fromName}" <${fromAddress}>` : fromAddress,
            to: msg.to.join(', '),
            cc: msg.cc && msg.cc.length > 0 ? msg.cc.join(', ') : undefined,
            subject: msg.subject || '(no subject)',
            text: msg.body,
        });

        return { messageId: info.messageId || '', provider: 'smtp' };
    },
};

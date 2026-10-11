import sgMail from '@sendgrid/mail';
import { config } from '../../../../config';
import { NotificationTransport, TransportMessage, TransportResult } from './index';

let initialized = false;
function ensureInit() {
    if (initialized) return;
    const key = config.notifications.sendgrid.apiKey;
    if (!key) throw new Error('SENDGRID_API_KEY is not configured');
    sgMail.setApiKey(key);
    initialized = true;
}

export const sendgridTransport: NotificationTransport = {
    type: 'email',
    async send(msg: TransportMessage): Promise<TransportResult> {
        if (process.env.E2E_TESTING === 'true') {
            console.log(`[sendgridTransport:mock] would send to ${(msg.to ?? []).join(',')} subject="${msg.subject ?? ''}"`);
            return { messageId: 'mock-e2e', provider: 'sendgrid-mock' };
        }
        ensureInit();
        const fromAddress = msg.fromAddress || config.notifications.fromAddress;
        const fromName = msg.fromName || config.notifications.fromName;
        if (!fromAddress) throw new Error('EMAIL_FROM_ADDRESS is not configured');

        const [response] = await sgMail.send({
            to: msg.to,
            cc: msg.cc && msg.cc.length > 0 ? msg.cc : undefined,
            from: { email: fromAddress, name: fromName },
            subject: msg.subject || '(no subject)',
            text: msg.body,
        });

        const messageId = response.headers?.['x-message-id'] || response.headers?.['X-Message-Id'] || '';
        return { messageId: String(messageId), provider: 'sendgrid' };
    },
};

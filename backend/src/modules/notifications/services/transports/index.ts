import { config } from '../../../../config';
import { sendgridTransport } from './sendgridTransport';
import { smtpTransport } from './smtpTransport';

export interface TransportMessage {
    to: string[];
    cc?: string[];
    subject?: string;
    body: string;
    fromName?: string;
    fromAddress?: string;
}

export interface TransportResult {
    messageId: string;
    provider: string;
}

export interface NotificationTransport {
    type: 'email' | 'sms';
    send(msg: TransportMessage): Promise<TransportResult>;
}

const registry = new Map<string, NotificationTransport>();

export function getTransport(transportType: string): NotificationTransport {
    const cached = registry.get(transportType);
    if (cached) return cached;

    if (transportType === 'email') {
        const driver = config.notifications.provider === 'sendgrid' ? sendgridTransport : smtpTransport;
        registry.set('email', driver);
        return driver;
    }

    throw new Error(`No transport registered for type '${transportType}'`);
}

export function resetTransportCache(): void {
    registry.clear();
}

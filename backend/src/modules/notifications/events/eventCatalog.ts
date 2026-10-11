export const EVENTS = {
    RISK_CREATED: 'risk.created',
    ACTION_ITEM_CREATED: 'action_item.created',
    RISK_UPDATED: 'risk.updated',
    ACTION_ITEM_UPDATED: 'action_item.updated',
    RISK_STATUS_UPDATED: 'risk.status.updated',
    ACTION_ITEM_STATUS_UPDATED: 'action_item.status.updated'
} as const;

export type NotificationEventCode = (typeof EVENTS)[keyof typeof EVENTS];

import { Job } from 'bullmq';
import { logger } from '../../../common/utils';
import { NotificationRule } from '../../../models/NotificationRule';
import { NotificationTemplate } from '../../../models/NotificationTemplate';
import { NotificationPendingAggregate } from '../../../models/NotificationPendingAggregate';
import { NotificationLog } from '../../../models/NotificationLog';
import { resolveRecipients } from './recipientResolver';
import { renderTemplate } from './templateRenderer';
import { getTransport } from './transports';
import { SendJobData, FlushJobData } from '../queues/notificationQueue';

async function renderAndSend(
    rule: NotificationRule,
    template: NotificationTemplate,
    events: Array<{ payload: Record<string, unknown>; scope: { projectId?: number | null; accountId?: number | null } }>,
    jobId: string
): Promise<void> {
    const primaryScope = events[0]?.scope ?? {};
    const projectId = primaryScope.projectId ?? null;
    const accountId = primaryScope.accountId ?? null;

    const { to, cc, skippedUserIds } = await resolveRecipients(
        rule.recipientsConfig,
        rule.ccConfig,
        { projectId, accountId }
    );

    // Derive project / actor / primary entity helpers for the template context
    const firstPayload: any = events[0]?.payload ?? {};
    const context = {
        count: events.length,
        events: events.map(e => e.payload),
        project: firstPayload.project ?? null,
        account: firstPayload.account ?? null,
        actor: firstPayload.actor ?? null,
        risk: firstPayload.risk ?? null,
        actionItem: firstPayload.actionItem ?? null,
    };

    const subject = template.subjectTemplate ? renderTemplate(template.subjectTemplate, context) : undefined;
    const body = renderTemplate(template.bodyTemplate, context);

    const logRow = await NotificationLog.create({
        eventCode: rule.eventCode,
        ruleId: rule.id,
        templateId: template.id,
        transport: rule.transport,
        recipients: to,
        cc,
        subject: subject ?? null,
        body,
        payloadSnapshot: { events: events.map(e => e.payload), skippedUserIds },
        status: 'QUEUED',
        projectId,
        accountId,
        jobId,
    } as any);

    if (to.length === 0) {
        const roles = (rule.recipientsConfig?.roles ?? []).join(',') || '(none)';
        const reason = `No recipients resolved. roles=[${roles}] projectId=${projectId ?? 'null'} accountId=${accountId ?? 'null'}; ${skippedUserIds.length} users matched roles but lack email (ids: ${skippedUserIds.join(',') || 'none'})`;
        await logRow.update({ status: 'SKIPPED', error: reason });
        logger.warn(`Notification skipped for rule ${rule.id} (${rule.eventCode}): ${reason}`, 'NotificationWorker');
        return;
    }

    try {
        const transport = getTransport(rule.transport);
        const result = await transport.send({ to, cc, subject, body });
        await logRow.update({ status: 'SENT', sentAt: new Date(), jobId: result.messageId || jobId });
        logger.info(`Notification sent: rule ${rule.id} → ${to.length} recipient(s)`, 'NotificationWorker');
    } catch (err: any) {
        await logRow.update({ status: 'FAILED', error: err?.message || String(err) });
        throw err;
    }
}

export async function processSendJob(job: Job<SendJobData>): Promise<void> {
    const { ruleId, payload, payloadScope } = job.data;
    const rule = await NotificationRule.findByPk(ruleId, { include: [NotificationTemplate] });
    if (!rule) {
        logger.warn(`Rule ${ruleId} not found (was it deleted?)`, 'NotificationWorker');
        return;
    }
    if (!rule.isActive) {
        logger.info(`Rule ${ruleId} inactive — skipping`, 'NotificationWorker');
        return;
    }
    const template = (rule as any).template as NotificationTemplate;
    if (!template || !template.isActive) {
        logger.warn(`Template for rule ${ruleId} missing or inactive`, 'NotificationWorker');
        return;
    }

    await renderAndSend(rule, template, [{ payload, scope: payloadScope }], String(job.id ?? ''));
}

export async function processFlushJob(job: Job<FlushJobData>): Promise<void> {
    const { pendingId } = job.data;
    const pending = await NotificationPendingAggregate.findByPk(pendingId);
    if (!pending) {
        logger.warn(`Pending aggregate ${pendingId} not found`, 'NotificationWorker');
        return;
    }
    if (pending.status === 'FLUSHED') {
        logger.info(`Pending aggregate ${pendingId} already flushed — skipping`, 'NotificationWorker');
        return;
    }

    const rule = await NotificationRule.findByPk(pending.ruleId, { include: [NotificationTemplate] });
    if (!rule || !rule.isActive) {
        await pending.update({ status: 'FLUSHED' });
        logger.info(`Rule for aggregate ${pendingId} missing/inactive — marked flushed`, 'NotificationWorker');
        return;
    }
    const template = (rule as any).template as NotificationTemplate;
    if (!template || !template.isActive) {
        await pending.update({ status: 'FLUSHED' });
        return;
    }

    const events = (pending.events as any[]) || [];
    await pending.update({ status: 'FLUSHED' });

    if (events.length === 0) {
        logger.warn(`Pending aggregate ${pendingId} had no events`, 'NotificationWorker');
        return;
    }

    await renderAndSend(rule, template, events as any, String(job.id ?? ''));
}

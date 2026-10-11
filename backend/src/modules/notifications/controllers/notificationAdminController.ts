/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { NotificationEvent } from '../../../models/NotificationEvent';
import { NotificationTemplate } from '../../../models/NotificationTemplate';
import { NotificationRule } from '../../../models/NotificationRule';
import { invalidateRuleCache } from '../services/notificationService';
import { clearTemplateCache } from '../services/templateRenderer';

// ── Events ───────────────────────────────────────────────────────────────────

export async function listEventsWithPagination(req: Request, res: Response) {
  const page = Number(req.query.pageNumber) || 1;
  const limit = Number(req.query.pageLimit) || 10;
  const offset = limit * (page - 1);
  const events = await NotificationEvent.findAndCountAll({
    limit: limit,
    offset: offset,
    order: [['code', 'ASC']],
  });
  return res.json({
    success: true,
    data: events.rows,
    totalItems: events.count,
  });
}

export async function listEventsWithoutPagination(req: Request, res: Response) {
  const events = await NotificationEvent.findAll({
    order: [['code', 'ASC']],
  });
  res.json(events);
}

// ── Templates ────────────────────────────────────────────────────────────────

export async function listTemplatesWithPagination(req: Request, res: Response) {
  const page = Number(req.query.pageNumber) || 1;
  const limit = Number(req.query.pageLimit) || 10;
  const offset = limit * (page - 1);
  const templates = await NotificationTemplate.findAndCountAll({
    limit: limit,
    offset: offset,
    order: [['code', 'ASC']],
  });
  return res.json({
    success: true,
    data: templates.rows,
    totalItems: templates.count,
  });
}

export async function listTemplatesWithoutPagination(req: Request, res: Response) {
  const templates = await NotificationTemplate.findAll({
    order: [['code', 'ASC']],
  });
  res.json(templates);
}

export async function createTemplate(req: Request, res: Response): Promise<void> {
  const { code, name, transport, subjectTemplate, bodyTemplate, isActive } = req.body ?? {};
  if (!code || !name || !transport || !bodyTemplate) {
    res.status(400).json({ error: 'code, name, transport, and bodyTemplate are required' });
    return;
  }
  const tpl = await NotificationTemplate.create({
    code,
    name,
    transport,
    subjectTemplate: subjectTemplate ?? null,
    bodyTemplate,
    isActive: isActive ?? true,
  } as any);
  clearTemplateCache();
  res.status(201).json(tpl);
}

export async function updateTemplate(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id as string);
  const tpl = await NotificationTemplate.findByPk(id);
  if (!tpl) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  const { name, transport, subjectTemplate, bodyTemplate, isActive } = req.body ?? {};
  await tpl.update({
    name: name ?? tpl.name,
    transport: transport ?? tpl.transport,
    subjectTemplate: subjectTemplate !== undefined ? subjectTemplate : tpl.subjectTemplate,
    bodyTemplate: bodyTemplate ?? tpl.bodyTemplate,
    isActive: isActive !== undefined ? isActive : tpl.isActive,
  });
  clearTemplateCache();
  res.json(tpl);
}

export async function deleteTemplate(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id as string);
  const tpl = await NotificationTemplate.findByPk(id);
  if (!tpl) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  const associatedRulesCount = await NotificationRule.count({
    where: { templateId: id },
  });

  if (associatedRulesCount > 0) {
    res.status(409).json({ error: 'Cannot delete. this template is associated to rules.' });
  } else {
    await tpl.destroy();
    clearTemplateCache();
    res.status(204).send();
  }
}

// ── Rules ────────────────────────────────────────────────────────────────────

export async function listRules(req: Request, res: Response) {
  const page = Number(req.query.pageNumber) || 1;
  const limit = Number(req.query.pageLimit) || 10;
  const offset = limit * (page - 1);
  const rules = await NotificationRule.findAndCountAll({
    limit: limit,
    offset: offset,
    include: [NotificationTemplate, NotificationEvent],
    order: [
      ['eventCode', 'ASC'],
      ['priority', 'ASC'],
    ],
  });
  return res.json({
    success: true,
    data: rules.rows,
    totalItems: rules.count,
  });
}

export async function createRule(req: Request, res: Response): Promise<void> {
  const body = req.body ?? {};
  if (!body.eventCode || !body.templateId || !body.transport) {
    res.status(400).json({ error: 'eventCode, templateId, and transport are required' });
    return;
  }
  const rule = await NotificationRule.create({
    eventCode: body.eventCode,
    templateId: body.templateId,
    transport: body.transport,
    recipientsConfig: body.recipientsConfig ?? {},
    ccConfig: body.ccConfig ?? null,
    scopeConfig: body.scopeConfig ?? null,
    coalesceWindowSeconds: body.coalesceWindowSeconds ?? null,
    coalesceKeyConfig: body.coalesceKeyConfig ?? null,
    isActive: body.isActive ?? true,
    priority: body.priority ?? 0,
  } as any);
  invalidateRuleCache();
  res.status(201).json(rule);
}

export async function updateRule(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id as string);
  const rule = await NotificationRule.findByPk(id);
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  const body = req.body ?? {};
  await rule.update({
    eventCode: body.eventCode ?? rule.eventCode,
    templateId: body.templateId ?? rule.templateId,
    transport: body.transport ?? rule.transport,
    recipientsConfig: body.recipientsConfig ?? rule.recipientsConfig,
    ccConfig: body.ccConfig !== undefined ? body.ccConfig : rule.ccConfig,
    scopeConfig: body.scopeConfig !== undefined ? body.scopeConfig : rule.scopeConfig,
    coalesceWindowSeconds:
      body.coalesceWindowSeconds !== undefined ? body.coalesceWindowSeconds : rule.coalesceWindowSeconds,
    coalesceKeyConfig: body.coalesceKeyConfig !== undefined ? body.coalesceKeyConfig : rule.coalesceKeyConfig,
    isActive: body.isActive !== undefined ? body.isActive : rule.isActive,
    priority: body.priority !== undefined ? body.priority : rule.priority,
  });
  invalidateRuleCache();
  res.json(rule);
}

export async function deleteRule(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id as string);
  const rule = await NotificationRule.findByPk(id);
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  await rule.destroy();
  invalidateRuleCache();
  res.status(204).send();
}

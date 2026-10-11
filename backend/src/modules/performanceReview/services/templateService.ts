import { Op } from 'sequelize';
import { CompetencyTemplate, TemplateStatus } from '../../../models/CompetencyTemplate';
import { CompetencyTemplateItem } from '../../../models/CompetencyTemplateItem';
import { LeadReview } from '../../../models/LeadReview';

/**
 * Competency template authoring.
 *
 * The governing rule: a template that has been answered is never edited. Reviews
 * pin the template version they were answered under, so editing in place would
 * retroactively change what a historical rating meant — and in an appraisal that
 * is indistinguishable from tampering.
 *
 * So: a draft is freely editable, an active template with no reviews against it is
 * still editable, and an active template that HAS been answered can only be
 * versioned.
 */

export const MAX_ITEMS = 30;

export class TemplateInUseError extends Error {
    constructor(templateId: number, reviewCount: number) {
        super(
            `Template ${templateId} has been used by ${reviewCount} review(s) and cannot be edited. Create a new version instead.`,
        );
        this.name = 'TemplateInUseError';
    }
}

export interface TemplateItemInput {
    id?: number;
    section?: string | null;
    key?: string;
    label: string;
    description?: string | null;
    inputType?: 'rating' | 'text' | 'boolean';
    weight?: number;
    isRequired?: boolean;
    requiresComment?: boolean;
    sortOrder?: number;
}

/** Stable, collision-free machine key derived from the label. */
export function makeItemKey(label: string, taken: Set<string>): string {
    const base =
        label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 48) || 'item';
    let key = base;
    let n = 2;
    while (taken.has(key)) key = `${base}_${n++}`;
    taken.add(key);
    return key;
}

/** How many non-superseded reviews have been authored against this template. */
export async function usageCount(templateId: number): Promise<number> {
    return LeadReview.count({
        where: { templateId, status: { [Op.ne]: 'draft' } },
    });
}

export async function listTemplates(accountId?: number): Promise<CompetencyTemplate[]> {
    return CompetencyTemplate.findAll({
        where: accountId
            ? { [Op.or]: [{ scope: 'account', accountId }, { scope: 'global' }] }
            : {},
        include: [CompetencyTemplateItem],
        order: [['name', 'ASC'], ['version', 'DESC']],
    });
}

export async function getTemplate(templateId: number): Promise<CompetencyTemplate | null> {
    return CompetencyTemplate.findByPk(templateId, { include: [CompetencyTemplateItem] });
}

function validateItems(items: TemplateItemInput[], scaleMin: number, scaleMax: number): string[] {
    const problems: string[] = [];
    if (items.length === 0) problems.push('A template needs at least one competency');
    if (items.length > MAX_ITEMS) problems.push(`A template cannot have more than ${MAX_ITEMS} competencies`);
    if (scaleMax <= scaleMin) problems.push('The top of the rating scale must be above the bottom');

    const ratingItems = items.filter(i => (i.inputType ?? 'rating') === 'rating');
    if (ratingItems.length === 0) {
        problems.push('A template needs at least one rated competency, or it cannot produce a score');
    }
    // A zero total weight would make the lead factor undefined rather than zero.
    const totalWeight = ratingItems.reduce((s, i) => s + (i.weight ?? 1), 0);
    if (ratingItems.length > 0 && totalWeight <= 0) {
        problems.push('Rated competencies must carry some weight between them');
    }
    for (const i of items) {
        if (!String(i.label ?? '').trim()) problems.push('Every competency needs a label');
        if ((i.weight ?? 1) < 0) problems.push(`"${i.label}" has a negative weight`);
    }
    return problems;
}

export interface TemplateInput {
    name: string;
    description?: string | null;
    scope?: 'global' | 'account' | 'project';
    accountId?: number | null;
    projectId?: number | null;
    ratingScaleMin?: number;
    ratingScaleMax?: number;
    ratingScaleLabels?: Record<string, string>;
    appliesToCategory?: string | null;
    items: TemplateItemInput[];
}

/** Create a draft template. */
export async function createTemplate(input: TemplateInput, userId: number): Promise<CompetencyTemplate> {
    const scaleMin = input.ratingScaleMin ?? 1;
    const scaleMax = input.ratingScaleMax ?? 5;
    const problems = validateItems(input.items ?? [], scaleMin, scaleMax);
    if (problems.length > 0) throw new Error(problems.join('; '));

    const template = await CompetencyTemplate.create({
        name: input.name,
        description: input.description ?? null,
        scope: input.scope ?? 'account',
        accountId: input.accountId ?? null,
        projectId: input.projectId ?? null,
        version: 1,
        status: 'draft',
        ratingScaleMin: scaleMin,
        ratingScaleMax: scaleMax,
        ratingScaleLabels: input.ratingScaleLabels ?? {},
        appliesToCategory: input.appliesToCategory ?? null,
        createdByUserId: userId,
    } as any);

    await writeItems(template.id, input.items);
    return (await getTemplate(template.id))!;
}

async function writeItems(templateId: number, items: TemplateItemInput[]): Promise<void> {
    const existing = await CompetencyTemplateItem.findAll({ where: { templateId } });
    const taken = new Set(existing.map(i => i.key));
    const keptIds = new Set<number>();

    for (const [index, item] of items.entries()) {
        const found = item.id ? existing.find(e => e.id === item.id) : undefined;
        const values = {
            templateId,
            section: item.section ?? null,
            label: item.label,
            description: item.description ?? null,
            inputType: item.inputType ?? 'rating',
            weight: item.weight ?? 1,
            isRequired: item.isRequired ?? true,
            requiresComment: item.requiresComment ?? true,
            sortOrder: item.sortOrder ?? index,
        };

        if (found) {
            // The key is deliberately NOT updated on an edit: it is the join key for
            // per-competency trends, so relabelling must not break history.
            await found.update(values);
            keptIds.add(found.id);
        } else {
            const created = await CompetencyTemplateItem.create({
                ...values,
                key: item.key?.trim() || makeItemKey(item.label, taken),
            } as any);
            keptIds.add(created.id);
        }
    }

    // Remove items dropped from the set. Safe only because this path is blocked
    // once the template has been answered.
    const removed = existing.filter(e => !keptIds.has(e.id));
    for (const r of removed) await r.destroy();
}

/** Update a template. Refused once it has been answered. */
export async function updateTemplate(
    templateId: number,
    input: Partial<TemplateInput>,
): Promise<CompetencyTemplate> {
    const template = await CompetencyTemplate.findByPk(templateId);
    if (!template) throw new Error(`Template ${templateId} not found`);

    const used = await usageCount(templateId);
    if (used > 0) throw new TemplateInUseError(templateId, used);

    const scaleMin = input.ratingScaleMin ?? template.ratingScaleMin;
    const scaleMax = input.ratingScaleMax ?? template.ratingScaleMax;
    if (input.items) {
        const problems = validateItems(input.items, scaleMin, scaleMax);
        if (problems.length > 0) throw new Error(problems.join('; '));
    }

    await template.update({
        name: input.name ?? template.name,
        description: input.description ?? template.description,
        ratingScaleMin: scaleMin,
        ratingScaleMax: scaleMax,
        ratingScaleLabels: input.ratingScaleLabels ?? template.ratingScaleLabels,
        appliesToCategory:
            input.appliesToCategory === undefined ? template.appliesToCategory : input.appliesToCategory,
    });

    if (input.items) await writeItems(templateId, input.items);
    return (await getTemplate(templateId))!;
}

/**
 * Create the next version of a template, copying its competencies.
 *
 * This is the only way to change a template that has been answered. The old
 * version is retired so new reviews pick up the new one, while every existing
 * review stays pinned to the version it was actually answered under.
 */
export async function createVersion(templateId: number, userId: number): Promise<CompetencyTemplate> {
    const original = await getTemplate(templateId);
    if (!original) throw new Error(`Template ${templateId} not found`);

    const siblings = await CompetencyTemplate.findAll({
        where: { name: original.name, accountId: original.accountId },
        attributes: ['version'],
    });
    const nextVersion = Math.max(...siblings.map(s => s.version), original.version) + 1;

    const copy = await CompetencyTemplate.create({
        name: original.name,
        description: original.description,
        scope: original.scope,
        accountId: original.accountId,
        projectId: original.projectId,
        version: nextVersion,
        parentTemplateId: original.id,
        status: 'draft',
        ratingScaleMin: original.ratingScaleMin,
        ratingScaleMax: original.ratingScaleMax,
        ratingScaleLabels: original.ratingScaleLabels,
        appliesToCategory: original.appliesToCategory,
        createdByUserId: userId,
    } as any);

    for (const item of original.items ?? []) {
        await CompetencyTemplateItem.create({
            templateId: copy.id,
            // Key carried across versions on purpose — that is what makes a
            // competency trendable across a template change.
            key: item.key,
            section: item.section,
            label: item.label,
            description: item.description,
            inputType: item.inputType,
            weight: item.weight,
            isRequired: item.isRequired,
            requiresComment: item.requiresComment,
            sortOrder: item.sortOrder,
        } as any);
    }

    return (await getTemplate(copy.id))!;
}

/** Activate a draft, retiring any other active template in the same family. */
export async function setStatus(templateId: number, status: TemplateStatus): Promise<CompetencyTemplate> {
    const template = await CompetencyTemplate.findByPk(templateId, { include: [CompetencyTemplateItem] });
    if (!template) throw new Error(`Template ${templateId} not found`);

    if (status === 'active') {
        const problems = validateItems(
            (template.items ?? []).map(i => ({
                label: i.label,
                inputType: i.inputType,
                weight: Number(i.weight),
            })),
            template.ratingScaleMin,
            template.ratingScaleMax,
        );
        if (problems.length > 0) {
            throw new Error(`Cannot activate: ${problems.join('; ')}`);
        }

        // Only one active version per family, or template resolution would be
        // ambiguous and two leads could answer different question sets.
        await CompetencyTemplate.update(
            { status: 'retired' },
            {
                where: {
                    name: template.name,
                    accountId: template.accountId,
                    status: 'active',
                    id: { [Op.ne]: template.id },
                },
            },
        );
    }

    await template.update({ status });
    return (await getTemplate(templateId))!;
}

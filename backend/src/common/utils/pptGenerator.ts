import PptxGenJS from 'pptxgenjs';
import path from 'path';
import fs from 'fs';
import { config } from '../../config';


interface AccountReportData {
    accountName: string;
    weekNumber: number;
    year: number;
    startDate: string;
    endDate: string;
    summary: string;
    risks: { summary: string; items: string[] } | string[];
    keyAccomplishments?: string[];
    actionItems?: string[];
    health: string;
    projects: {
        name: string;
        summary: string;
        risks: string;
        status: string;
        achievements: string;
    }[];
    projectsMissing: string[];
}

interface AccountMonthlyReportData {
    accountName: string;
    month: number;
    year: number;
    summary: string;
    risks: { summary: string; items: string[] } | string[];
    keyAccomplishments?: string[];
    actionItems?: string[];
    annexure?: { title: string; points: string[] }[];
    health: string;
    projects?: {
        name: string;
        summary: string;
        risks: string;
        status: string;
        achievements: string;
        teamMembers?: { name: string; role: string }[];
    }[];
    projectsMissing?: string[];
}

interface ProgramReportData {
    programName: string;
    accountName: string;
    weekNumber: number;
    year: number;
    startDate: string;
    endDate: string;
    summary: string;
    risks: { summary: string; items: string[] } | string[];
    keyAccomplishments?: string[];
    actionItems?: string[];
    health: string;
    projects: {
        name: string;
        summary: string;
        risks: string;
        status: string;
        achievements: string;
    }[];
    projectsMissing?: string[];
}

interface ProgramMonthlyReportData {
    programName: string;
    accountName: string;
    month: number;
    year: number;
    summary: string;
    risks: { summary: string; items: string[] } | string[];
    keyAccomplishments?: string[];
    actionItems?: string[];
    annexure?: { title: string; points: string[] }[];
    health: string;
    projects?: {
        name: string;
        summary: string;
        risks: string;
        status: string;
        achievements: string;
        teamMembers?: { name: string; role: string }[];
    }[];
    projectsMissing?: string[];
}

type DeckScope = 'account' | 'program';
/** Also selects the visual style: weekly = plain titles, monthly = header band + cards. */
type DeckPeriod = 'weekly' | 'monthly';

interface DeckProject {
    name: string;
    summary: string;
    risks: string;
    status: string;
    achievements: string;
    teamMembers?: { name: string; role: string }[];
}

interface DeckData {
    scope: DeckScope;
    period: DeckPeriod;
    entityName: string;
    accountName?: string;
    weekNumber?: number;
    startDate?: string;
    endDate?: string;
    month?: number;
    year: number;
    summary: string;
    keyAccomplishments?: string[];
    risks: { summary: string; items: string[] } | string[] | string;
    actionItems?: string[];
    annexure?: { title: string; points: string[] }[];
    health: string;
    projects: DeckProject[];
    projectsMissing?: string[];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// Plain (weekly) bullet slides pack to a line budget so a slide fills before
// spilling to the next, rather than a fixed item count that leaves it half-empty.
// Calibrated against rendered decks: the 4"-tall content box holds ~20 wrapped
// lines at 10pt; 18 leaves a safe bottom margin. A line of this box width fits
// ~115 chars at 10pt Arial.
const PLAIN_CHARS_PER_LINE = 115;
const PLAIN_LINE_BUDGET = 18;
// A risk summary box on the first slide consumes ~1", i.e. ~5 lines of budget.
const RISK_SUMMARY_LINE_COST = 5;

// Real per-item truncation budget for weekly (non-card) bullet lists -- risks, achievements,
// action items. Shared by paginateBullets' line-count estimate and every render call for these
// lists, so the two stay in lockstep: raising this alone (not the individual call sites) keeps
// paginateBullets' "how many lines will this item take" estimate accurate.
const PLAIN_BULLET_ITEM_CHARS = 400;

// Common abbreviations that end in "." but are not sentence ends -- without this, truncate()'s
// sentence-boundary detector treats e.g. "vs. 3 previous week" as a complete sentence ending at
// "vs.", since a "." followed by whitespace + a digit/capital looks like a genuine sentence start.
// Found via a real truncated cell that stopped at "...tickets vs." (LOSAI, CCM week 39).
const NON_TERMINAL_ABBREVIATIONS = new Set([
    'vs', 'etc', 'eg', 'ie', 'approx', 'inc', 'no', 'fig', 'vol', 'pg', 'pp',
    'mr', 'mrs', 'dr', 'jr', 'sr', 'st', 'ave', 'blvd', 'dept', 'est', 'min', 'max', 'misc', 'ref'
]);

/**
 * Deck layout version, embedded in every generated filename.
 *
 * Decks are written once at report-generation time and then served from the
 * stored filePath, so a layout change would otherwise never reach reports that
 * already exist. Stamping the version into the filename lets a download detect
 * that its deck predates the current layout and re-render it on the spot.
 *
 * BUMP THIS whenever buildStandardDeck's output changes in a way existing decks
 * should pick up.
 */
export const DECK_TEMPLATE_VERSION = 'v4';

export class PptGenerator {

    // ─────────────────────────────────────────────────────────────
    // Public entry points — thin mappers onto buildStandardDeck
    // ─────────────────────────────────────────────────────────────

    async generateAccountWeeklyReport(data: AccountReportData): Promise<string> {
        return this.buildStandardDeck({
            scope: 'account',
            period: 'weekly',
            entityName: data.accountName,
            weekNumber: data.weekNumber,
            startDate: data.startDate,
            endDate: data.endDate,
            year: data.year,
            summary: data.summary,
            keyAccomplishments: data.keyAccomplishments,
            risks: data.risks,
            actionItems: data.actionItems,
            health: data.health,
            projects: data.projects || [],
            projectsMissing: data.projectsMissing
        });
    }

    async generateAccountMonthlyReport(data: AccountMonthlyReportData): Promise<string> {
        return this.buildStandardDeck({
            scope: 'account',
            period: 'monthly',
            entityName: data.accountName,
            month: data.month,
            year: data.year,
            summary: data.summary,
            keyAccomplishments: data.keyAccomplishments,
            risks: data.risks,
            actionItems: data.actionItems,
            annexure: data.annexure,
            health: data.health,
            projects: data.projects || [],
            projectsMissing: data.projectsMissing
        });
    }

    async generateProgramWeeklyReport(data: ProgramReportData): Promise<string> {
        return this.buildStandardDeck({
            scope: 'program',
            period: 'weekly',
            entityName: data.programName,
            accountName: data.accountName,
            weekNumber: data.weekNumber,
            startDate: data.startDate,
            endDate: data.endDate,
            year: data.year,
            summary: data.summary,
            keyAccomplishments: data.keyAccomplishments,
            risks: data.risks,
            actionItems: data.actionItems,
            health: data.health,
            projects: data.projects || [],
            projectsMissing: data.projectsMissing
        });
    }

    async generateProgramMonthlyReport(data: ProgramMonthlyReportData): Promise<string> {
        return this.buildStandardDeck({
            scope: 'program',
            period: 'monthly',
            entityName: data.programName,
            accountName: data.accountName,
            month: data.month,
            year: data.year,
            summary: data.summary,
            keyAccomplishments: data.keyAccomplishments,
            risks: data.risks,
            actionItems: data.actionItems,
            annexure: data.annexure,
            health: data.health,
            projects: data.projects || [],
            projectsMissing: data.projectsMissing
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Deck core — the single source of section order for all decks
    // ─────────────────────────────────────────────────────────────

    private async buildStandardDeck(deck: DeckData): Promise<string> {
        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_16x9';

        const assetsPath = this.resolveAssetsPath();
        this.defineMasters(pptx, assetsPath);

        const knownProjects = [
            ...(deck.projects || []).map(p => p.name).filter(Boolean),
            ...(deck.projectsMissing || [])
        ];

        const { summary: riskSummary, items: rawRiskItems } = this.normalizeRisks(deck.risks);
        const achievements = this.groupItemsByProject(deck.keyAccomplishments || [], knownProjects);
        const risks = this.groupItemsByProject(rawRiskItems, knownProjects);
        const actionItems = (deck.actionItems || [])
            .map(a => this.stripMarkdown(String(a || '')).replace(/^[-•*▶■]\s*/, '').trim())
            .filter(Boolean);

        this.addTitleSlide(pptx, deck);
        this.addAgendaSlide(pptx, deck);
        this.addExecSummarySlide(pptx, deck);
        this.addAchievementsSlides(pptx, deck, achievements);
        this.addRisksSlides(pptx, deck, riskSummary, risks);
        this.addActionItemsSlides(pptx, deck, actionItems);
        this.addProjectDetailsSlides(pptx, deck);
        this.addThankYouSlide(pptx);

        if (deck.period === 'monthly') {
            this.addAnnexureSlides(pptx, deck);
        }

        return this.saveDeck(pptx, this.deckFileName(deck));
    }

    // ─────────────────────────────────────────────────────────────
    // Section builders (private — order is owned by buildStandardDeck)
    // ─────────────────────────────────────────────────────────────

    private addTitleSlide(pptx: PptxGenJS, deck: DeckData): void {
        const slide = pptx.addSlide({ masterName: 'MASTER_TITLE' });
        const isProgram = deck.scope === 'program';
        const isMonthly = deck.period === 'monthly';

        const label = isMonthly
            ? (isProgram ? 'Monthly Program Review' : 'Monthly Business Review')
            : (isProgram ? 'Weekly Program Update' : 'Weekly Project Update');

        const periodText = isMonthly
            ? `${MONTH_NAMES[(deck.month || 1) - 1] || 'Month ' + deck.month} ${deck.year}`
            : `${deck.startDate} – ${deck.endDate}`;

        const labelY = isMonthly ? 2.8 : 3.0;
        const nameY = isMonthly ? 3.5 : 3.7;
        const subY = isMonthly ? 4.22 : 4.42;
        const periodY = isProgram ? (isMonthly ? 4.58 : 4.78) : (isMonthly ? 4.3 : 4.5);

        slide.addText(label, {
            x: 0.5, y: labelY, w: 4.0, h: 0.6,
            fontSize: isMonthly ? 20 : 22, color: '666666', fontFace: 'Arial'
        });
        slide.addText(deck.entityName, {
            x: 0.5, y: nameY, w: 4.0, h: 0.7,
            fontSize: 32, bold: true, color: '333333', fontFace: 'Arial'
        });
        if (isProgram && deck.accountName) {
            slide.addText(deck.accountName, {
                x: 0.5, y: subY, w: 4.0, h: 0.3,
                fontSize: 12, color: '888888', fontFace: 'Arial'
            });
        }
        slide.addText(periodText, {
            x: 0.5, y: periodY, w: 4.0, h: 0.4,
            fontSize: 14, color: isMonthly ? '888888' : '666666', fontFace: 'Arial'
        });
    }

    private addAgendaSlide(pptx: PptxGenJS, deck: DeckData): void {
        const slide = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
        const sections = ['Executive Summary', 'Key Achievements', 'Risks', 'Action Items', 'Project Details'];
        const contentY = this.applySectionHeader(pptx, slide, deck, 'Agenda');

        slide.addText(
            sections.map((s, i) => ({
                text: s,
                options: { bullet: true, breakLine: i < sections.length - 1 }
            })),
            {
                x: 0.5, y: contentY + 0.1, w: 9.0, h: 3.5,
                fontSize: 18, color: '333333', fontFace: 'Arial', lineSpacing: 40, valign: 'top'
            }
        );
    }

    private addExecSummarySlide(pptx: PptxGenJS, deck: DeckData): void {
        const slide = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
        const contentY = this.applySectionHeader(pptx, slide, deck, 'Executive Summary');

        if (deck.period === 'monthly') {
            this.addHealthBadge(pptx, slide, deck.health);
            slide.addShape(pptx.ShapeType.rect, {
                x: 0.35, y: contentY, w: 9.25, h: 4.18,
                fill: { color: 'F2F7FF' }, line: { color: 'C4D8F0', pt: 1 }
            });
            slide.addShape(pptx.ShapeType.rect, {
                x: 0.35, y: contentY, w: 0.055, h: 4.18,
                fill: { color: '003366' }, line: { color: '003366' }
            });
            slide.addText(this.truncate(this.stripMarkdown(deck.summary), 1400), {
                x: 0.55, y: contentY + 0.12, w: 9.0, h: 3.94,
                fontSize: 12.5, align: 'left', color: '1A2B45', fontFace: 'Arial', lineSpacing: 22, valign: 'top'
            });
            return;
        }

        slide.addText(this.truncate(deck.summary, 1400), {
            x: 0.5, y: contentY, w: 9.0, h: 4.1,
            fontSize: 13, align: 'justify', color: '333333', fontFace: 'Arial', lineSpacing: 22, valign: 'top'
        });
    }

    private addAchievementsSlides(pptx: PptxGenJS, deck: DeckData, items: string[]): void {
        const isMonthly = deck.period === 'monthly';

        if (!isMonthly) {
            this.addPlainBulletSlides(pptx, deck, 'Key Achievements', items, 'No major achievements to report for this period.');
            return;
        }

        const PER_SLIDE = 4;
        const CARD_H = 0.87;
        const CARD_GAP = 0.075;
        const total = Math.ceil(Math.max(items.length, 1) / PER_SLIDE);

        for (let i = 0; i < total; i++) {
            const slide = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
            const suffix = total > 1 ? ` (${i + 1}/${total})` : '';
            const contentY = this.applySectionHeader(pptx, slide, deck, 'Key Achievements', suffix);
            const current = items.slice(i * PER_SLIDE, (i + 1) * PER_SLIDE);

            if (current.length === 0) {
                slide.addText('No major achievements to report for this period.', {
                    x: 0.5, y: 2.5, w: 9.0, fontSize: 14, color: '888888', fontFace: 'Arial', italic: true, align: 'center'
                });
                continue;
            }

            current.forEach((item, idx) => {
                const globalNum = i * PER_SLIDE + idx + 1;
                const cardY = contentY + idx * (CARD_H + CARD_GAP);
                slide.addShape(pptx.ShapeType.rect, {
                    x: 0.35, y: cardY, w: 9.25, h: CARD_H,
                    fill: { color: 'EEF4FF' }, line: { color: 'B8CFED', pt: 1 }
                });
                slide.addShape(pptx.ShapeType.rect, {
                    x: 0.35, y: cardY, w: 0.055, h: CARD_H,
                    fill: { color: '2E6DA4' }, line: { color: '2E6DA4' }
                });
                slide.addShape(pptx.ShapeType.ellipse, {
                    x: 0.52, y: cardY + 0.215, w: 0.42, h: 0.42,
                    fill: { color: '003366' }, line: { color: '003366' }
                });
                slide.addText(String(globalNum), {
                    x: 0.52, y: cardY + 0.215, w: 0.42, h: 0.42,
                    fontSize: 11, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: 'Arial'
                });
                // Fixed CARD_H (0.87in) box, not auto-sizing -- ~219 chars is the real safe max
                // at this font/line-spacing/width before text would overflow the card. 215 stays
                // just under that; unlike the table cells above, this can't be raised much
                // further without also growing CARD_H and re-deriving PER_SLIDE.
                slide.addText(this.truncate(item, 215), {
                    x: 1.08, y: cardY + 0.08, w: 8.42, h: CARD_H - 0.16,
                    fontSize: 12.5, color: '1A2B45', fontFace: 'Arial', lineSpacing: 20, valign: 'middle', bold: false
                });
            });
        }
    }

    private addRisksSlides(pptx: PptxGenJS, deck: DeckData, riskSummary: string, items: string[]): void {
        const isMonthly = deck.period === 'monthly';

        if (!isMonthly) {
            const firstBudget = riskSummary ? PLAIN_LINE_BUDGET - RISK_SUMMARY_LINE_COST : PLAIN_LINE_BUDGET;
            const pages = this.paginateBullets(items, firstBudget);
            pages.forEach((pageItems, i) => {
                const slide = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
                const suffix = pages.length > 1 ? ` (${i + 1}/${pages.length})` : '';
                let contentY = this.applySectionHeader(pptx, slide, deck, 'Risks', suffix);

                if (i === 0 && riskSummary) {
                    slide.addText([
                        { text: 'Summary: ', options: { bold: true } },
                        // 0.9in box @ 11pt/16pt line spacing, 9.0in wide -> ~4 real lines, ~104
                        // chars/line -> ~400 chars safely fits without overflowing the box.
                        { text: this.truncate(riskSummary, 400), options: { bold: false } }
                    ], {
                        x: 0.5, y: contentY, w: 9.0, h: 0.9,
                        fontSize: 11, color: '000000', fontFace: 'Arial', lineSpacing: 16, valign: 'top'
                    });
                    contentY += 1.0;
                }

                const itemsBoxH = Math.max(0.5, 4.9 - contentY);

                if (pageItems.length > 0) {
                    slide.addText(pageItems.map(item => ({
                        text: this.truncate(item, PLAIN_BULLET_ITEM_CHARS),
                        options: { bullet: true, breakLine: true, paraSpaceBefore: 6, fontSize: 10, fontFace: 'Arial', lineSpacing: 16 }
                    })), {
                        x: 0.5, y: contentY, w: 9.0, h: itemsBoxH,
                        align: 'left', color: '333333', valign: 'top'
                    });
                } else if (i === 0 && !riskSummary) {
                    slide.addText('No critical risks reported.', { x: 0.5, y: contentY, w: 9.0, fontSize: 12 });
                }
            });
            return;
        }

        const CARD_H = 1.1;
        const CARD_GAP = 0.07;
        const FIRST = riskSummary ? 2 : 3;
        const PER_SLIDE = 3;
        const total = riskSummary
            ? Math.ceil(Math.max(items.length - FIRST, 0) / PER_SLIDE) + 1
            : Math.ceil(Math.max(items.length, 1) / PER_SLIDE);

        for (let i = 0; i < total; i++) {
            const slide = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
            const suffix = total > 1 ? ` (${i + 1}/${total})` : '';
            const contentY = this.applySectionHeader(pptx, slide, deck, 'Risks', suffix);

            let cardStartY = contentY;
            const itemsOnThisSlide = i === 0 ? FIRST : PER_SLIDE;
            const itemOffset = i === 0 ? 0 : FIRST + (i - 1) * PER_SLIDE;

            if (i === 0 && riskSummary) {
                slide.addShape(pptx.ShapeType.rect, {
                    x: 0.35, y: contentY, w: 9.25, h: 0.72,
                    fill: { color: 'FFF8EE' }, line: { color: 'F5D9A6', pt: 1 }
                });
                slide.addShape(pptx.ShapeType.rect, {
                    x: 0.35, y: contentY, w: 0.055, h: 0.72,
                    fill: { color: 'FF9800' }, line: { color: 'FF9800' }
                });
                // Fixed 0.6in box -- ~270 chars is the real safe max here (smaller than the
                // weekly risk-summary box above); 260 stays just under it.
                slide.addText(this.truncate(this.stripMarkdown(riskSummary), 260), {
                    x: 0.55, y: contentY + 0.06, w: 9.0, h: 0.6,
                    fontSize: 11.5, color: '5C3D00', fontFace: 'Arial', lineSpacing: 16, italic: true, valign: 'top', wrap: true
                });
                cardStartY = contentY + 0.78;
            }

            const current = items.slice(itemOffset, itemOffset + itemsOnThisSlide);
            if (current.length > 0) {
                current.forEach((item, idx) => {
                    const cardY = cardStartY + idx * (CARD_H + CARD_GAP);
                    const iconY = cardY + (CARD_H - 0.42) / 2;
                    slide.addShape(pptx.ShapeType.rect, {
                        x: 0.35, y: cardY, w: 9.25, h: CARD_H,
                        fill: { color: 'FFF4E6' }, line: { color: 'F5D9A6', pt: 1 }
                    });
                    slide.addShape(pptx.ShapeType.rect, {
                        x: 0.35, y: cardY, w: 0.055, h: CARD_H,
                        fill: { color: 'FF9800' }, line: { color: 'FF9800' }
                    });
                    slide.addShape(pptx.ShapeType.ellipse, {
                        x: 0.52, y: iconY, w: 0.42, h: 0.42,
                        fill: { color: 'FF9800' }, line: { color: 'E68900' }
                    });
                    slide.addText('!', {
                        x: 0.52, y: iconY, w: 0.42, h: 0.42,
                        fontSize: 14, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: 'Arial'
                    });
                    // Fixed CARD_H (1.1in) box -- ~368 chars is the real safe max at this
                    // font/line-spacing/width; 350 stays just under it.
                    slide.addText(this.truncate(item, 350), {
                        x: 1.08, y: cardY + 0.1, w: 8.3, h: CARD_H - 0.2,
                        fontSize: 11, color: '3D1F00', fontFace: 'Arial', lineSpacing: 17, valign: 'middle', wrap: true
                    });
                });
            } else if (i === 0 && !riskSummary) {
                slide.addText('No critical risks identified for this period.', {
                    x: 0.5, y: 2.5, w: 9.0, fontSize: 14, color: '888888', fontFace: 'Arial', italic: true, align: 'center'
                });
            }
        }
    }

    private addActionItemsSlides(pptx: PptxGenJS, deck: DeckData, items: string[]): void {
        if (items.length === 0) return;
        const isMonthly = deck.period === 'monthly';

        if (!isMonthly) {
            this.addPlainBulletSlides(pptx, deck, 'Action Items', items);
            return;
        }

        const PER_SLIDE = 5;
        const CARD_H = 0.78;
        const CARD_GAP = 0.065;
        const total = Math.ceil(items.length / PER_SLIDE);

        for (let i = 0; i < total; i++) {
            const slide = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
            const suffix = total > 1 ? ` (${i + 1}/${total})` : '';
            const contentY = this.applySectionHeader(pptx, slide, deck, 'Action Items', suffix);
            const current = items.slice(i * PER_SLIDE, (i + 1) * PER_SLIDE);

            current.forEach((item, idx) => {
                const globalNum = i * PER_SLIDE + idx + 1;
                const cardY = contentY + idx * (CARD_H + CARD_GAP);
                const iconY = cardY + (CARD_H - 0.40) / 2;
                slide.addShape(pptx.ShapeType.rect, {
                    x: 0.35, y: cardY, w: 9.25, h: CARD_H,
                    fill: { color: 'EFF8EF' }, line: { color: 'B0D8B0', pt: 1 }
                });
                slide.addShape(pptx.ShapeType.rect, {
                    x: 0.35, y: cardY, w: 0.055, h: CARD_H,
                    fill: { color: '388E3C' }, line: { color: '388E3C' }
                });
                slide.addShape(pptx.ShapeType.ellipse, {
                    x: 0.52, y: iconY, w: 0.40, h: 0.40,
                    fill: { color: '2E7D32' }, line: { color: '2E7D32' }
                });
                slide.addText(String(globalNum), {
                    x: 0.52, y: iconY, w: 0.40, h: 0.40,
                    fontSize: 11, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: 'Arial'
                });
                // Fixed CARD_H (0.78in) box -- ~237 chars is the real safe max here; 230 stays
                // just under it.
                slide.addText(this.truncate(item, 230), {
                    x: 1.06, y: cardY + 0.1, w: 8.3, h: CARD_H - 0.2,
                    fontSize: 11, color: '1A3A1A', fontFace: 'Arial', lineSpacing: 17, valign: 'middle', wrap: true
                });
            });
        }
    }

    /**
     * Project details table.
     *
     * Cells are hard-capped BEFORE paging: pptxgenjs breaks pages at row boundaries
     * only and cannot split a single row, so an uncapped summary yields a row taller
     * than the slide that overflows regardless of the autoPage options.
     */
    private addProjectDetailsSlides(pptx: PptxGenJS, deck: DeckData): void {
        // Table rows here auto-size to their content (no rowH set) and autoPage pushes whatever
        // doesn't fit to a new slide -- unlike the fixed-height cards/boxes elsewhere in this
        // file, a row can safely be much taller than ~4 lines. Raised from the original 260/200
        // (an arbitrary "~4 lines" guess) to ~11 lines each, comfortably short of dominating a
        // whole page by itself while covering real content far more often than the old budget
        // did (the real trigger for this change: WordPress's real week-39 risks text, 235 chars
        // with zero punctuation to cut at, exceeded the old 200-char cap for no good reason).
        const SUMM_CELL_CHARS = 700;   // 3.85" col @ 9pt ≈ 62 chars/line × ~11 lines
        const RISK_CELL_CHARS = 550;   // 3.20" col @ 9pt ≈ 52 chars/line × ~11 lines

        const slide = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
        const contentY = this.applySectionHeader(pptx, slide, deck, 'Project Details');

        const headerCell = (text: string) => ({
            text,
            options: { bold: true, fill: '003366', color: 'FFFFFF', fontFace: 'Arial' }
        });
        const tableData: any[] = [[
            headerCell('Project'),
            headerCell('Status'),
            headerCell('Summary / Key Achievements'),
            headerCell('Risks')
        ]];

        (deck.projects || []).forEach(p => {
            const strippedSummary = this.stripMarkdown(p.summary || p.achievements || '');
            const strippedRisks = this.stripMarkdown(p.risks || '');

            tableData.push([
                { text: p.name, options: { fill: 'F2F2F2', fontSize: 10, bold: true, fontFace: 'Arial' } },
                { text: p.status, options: { color: this.getHealthColor(p.status), align: 'center', fontSize: 10, bold: true, fontFace: 'Arial' } },
                {
                    text: this.parseMarkdown(this.truncate(strippedSummary, SUMM_CELL_CHARS)),
                    options: { fontSize: 9, valign: 'top', fontFace: 'Arial' }
                },
                {
                    text: this.parseMarkdown(this.truncate(strippedRisks, RISK_CELL_CHARS)),
                    options: { fontSize: 9, color: '000000', valign: 'top', fontFace: 'Arial' }
                }
            ]);
        });

        (deck.projectsMissing || []).forEach(projectName => {
            tableData.push([
                { text: projectName, options: { fill: 'F2F2F2', fontSize: 10, bold: true, fontFace: 'Arial', color: '888888' } },
                { text: 'N/A', options: { color: '888888', align: 'center', fontSize: 10, fontFace: 'Arial' } },
                { text: 'No data available for this period.', options: { fontSize: 9, color: '888888', valign: 'top', fontFace: 'Arial', italics: true } },
                { text: '', options: { fontSize: 9, valign: 'top', fontFace: 'Arial' } }
            ]);
        });

        slide.addTable(tableData, {
            x: 0.35, y: contentY, w: 9.25,
            colW: [1.35, 0.85, 3.85, 3.20],
            border: { color: 'CCCCCC', pt: 1 },
            fontSize: 9,
            valign: 'top',
            margin: [0.03, 0.05, 0.03, 0.05],
            autoPage: true,
            autoPageRepeatHeader: true,
            autoPageHeaderRows: 1,
            autoPageSlideStartY: contentY,
            autoPageLineWeight: 0.4,
            masterName: 'MASTER_CONTENT'
        } as any);
    }

    private addAnnexureSlides(pptx: PptxGenJS, deck: DeckData): void {
        const CONTENT_Y = 0.82;
        const annexureItems = Array.isArray(deck.annexure)
            ? deck.annexure.filter(a => a?.title && Array.isArray(a.points) && a.points.length > 0)
            : [];
        const projectsWithData = (deck.projects || []).filter(p => p.name);
        if (annexureItems.length === 0 && projectsWithData.length === 0) return;

        // Divider slide
        const slideDiv = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
        slideDiv.addShape(pptx.ShapeType.rect, {
            x: 0, y: 1.8, w: 10, h: 2.0,
            fill: { color: '003366' }, line: { color: '003366' }
        });
        slideDiv.addText('Annexure', {
            x: 0.5, y: 2.0, w: 9.0, h: 1.2,
            fontSize: 36, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: 'Arial'
        });
        slideDiv.addText('Supplementary Detail — For Presenter Reference', {
            x: 0.5, y: 3.15, w: 9.0, h: 0.4,
            fontSize: 13, color: '888888', align: 'center', fontFace: 'Arial', italic: true
        });

        let annexIdx = 0;
        const nextLetter = () => String.fromCharCode(65 + annexIdx++);

        annexureItems.forEach((section) => {
            const slideAnn = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
            this.addSlideHeader(pptx, slideAnn, `Annexure ${nextLetter()} — ${section.title}`);

            slideAnn.addShape(pptx.ShapeType.rect, {
                x: 0.35, y: CONTENT_Y, w: 9.25, h: 4.08,
                fill: { color: 'F9FAFC' }, line: { color: 'D8DDE8', pt: 1 }
            });
            const bulletItems = section.points.map(pt => ({
                // Modest per-item bump (this shared 3.85in box holds all of a section's points
                // together, uncapped by count -- a pre-existing, separate constraint this plan
                // doesn't attempt to resolve).
                text: this.truncate(this.stripMarkdown(pt), 320),
                options: { bullet: true, breakLine: true, paraSpaceBefore: 10, fontSize: 12.5, fontFace: 'Arial', lineSpacing: 20 }
            }));
            slideAnn.addText(bulletItems, { x: 0.55, y: CONTENT_Y + 0.1, w: 8.95, h: 3.85, align: 'left', color: '222222', valign: 'top' });
        });

        if (projectsWithData.length === 0) return;

        // Team Details — one project per slide, all members shown.
        // Fixed zones (inches from CONTENT_Y = 0.82)
        const NAME_H = 0.34;  // navy name bar
        const SUMM_H = 0.80;  // summary box (3 lines at 10pt)
        const LABEL_H = 0.26;  // "Team Members" label bar
        const ROW_H = 0.22;  // every table row — explicit, prevents inflation
        // Table starts at CONTENT_Y + 1.40; available height 3.33" → 14 rows
        const MEMBERS_FIRST = 14;
        const MEMBERS_CONT = 16;
        // Fixed SUMM_H (0.80in) box -- ~350 chars is the real safe max at this font/line-spacing/
        // width; 340 stays just under it without needing to grow SUMM_H (which would also shift
        // labelY/tableY/MEMBERS_FIRST below).
        const SUMM_CHARS = 340;

        const sectionLabel = `Annexure ${nextLetter()} — Team Details`;
        let teamSectionFirst = true;
        const getTeamSlideLabel = () => {
            if (teamSectionFirst) { teamSectionFirst = false; return sectionLabel; }
            return 'Team Details (cont.)';
        };

        const buildTable = (members: { name: string; role: string }[]) => {
            const hdr = [
                { text: 'Name', options: { bold: true, fill: '1A3A6B', color: 'FFFFFF', fontFace: 'Arial', fontSize: 9.5 } },
                { text: 'Role', options: { bold: true, fill: '1A3A6B', color: 'FFFFFF', fontFace: 'Arial', fontSize: 9.5 } }
            ];
            const rows: any[] = [hdr];
            members.forEach((m, mi) => {
                const rf = mi % 2 === 0 ? 'FFFFFF' : 'EEF2FC';
                rows.push([
                    { text: m.name, options: { fill: rf, fontSize: 9.5, fontFace: 'Arial', color: '1A2B45' } },
                    { text: m.role || 'Team Member', options: { fill: rf, fontSize: 9.5, color: '444466', fontFace: 'Arial' } }
                ]);
            });
            return rows;
        };

        projectsWithData.forEach(p => {
            const allMembers = p.teamMembers || [];
            const firstBatch = allMembers.slice(0, MEMBERS_FIRST);
            const overflow = allMembers.slice(MEMBERS_FIRST);

            const sl = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
            this.addSlideHeader(pptx, sl, getTeamSlideLabel());

            sl.addShape(pptx.ShapeType.rect, {
                x: 0.35, y: CONTENT_Y, w: 9.25, h: NAME_H,
                fill: { color: '1A3A6B' }, line: { color: '1A3A6B' }
            });
            const sc = this.getHealthColor(p.status);
            sl.addShape(pptx.ShapeType.rect, {
                x: 7.70, y: CONTENT_Y + 0.05, w: 1.55, h: NAME_H - 0.10,
                fill: { color: sc }, line: { color: sc }
            });
            sl.addText(p.status || 'N/A', {
                x: 7.70, y: CONTENT_Y + 0.05, w: 1.55, h: NAME_H - 0.10,
                fontSize: 9, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: 'Arial'
            });
            sl.addText(p.name, {
                x: 0.48, y: CONTENT_Y + 0.05, w: 7.0, h: NAME_H - 0.10,
                fontSize: 11, bold: true, color: 'FFFFFF', fontFace: 'Arial', valign: 'middle'
            });

            const raw = p.summary || p.achievements || 'No summary available.';
            const summText = this.truncate(raw, SUMM_CHARS);
            const summY = CONTENT_Y + NAME_H;
            sl.addShape(pptx.ShapeType.rect, {
                x: 0.35, y: summY, w: 9.25, h: SUMM_H,
                fill: { color: 'F5F8FF' }, line: { color: 'C8D8F0', pt: 1 }
            });
            sl.addText(summText, {
                x: 0.50, y: summY + 0.08, w: 8.90, h: SUMM_H - 0.16,
                fontSize: 10, color: '2C2C44', fontFace: 'Arial',
                valign: 'top', wrap: true, lineSpacing: 15
            });

            const labelY = summY + SUMM_H;
            sl.addShape(pptx.ShapeType.rect, {
                x: 0.35, y: labelY, w: 9.25, h: LABEL_H,
                fill: { color: 'E8EFF8' }, line: { color: 'C8D8F0', pt: 1 }
            });
            sl.addText('Team Members', {
                x: 0.50, y: labelY + 0.04, w: 9.0, h: LABEL_H - 0.08,
                fontSize: 9, bold: true, color: '003366', fontFace: 'Arial', valign: 'middle'
            });

            const tableY = labelY + LABEL_H;
            if (firstBatch.length > 0) {
                const rows = buildTable(firstBatch);
                sl.addTable(rows, {
                    x: 0.35, y: tableY, w: 9.25,
                    colW: [4.625, 4.625],
                    rowH: Array(rows.length).fill(ROW_H),
                    border: { color: 'D0DAF0', pt: 1 },
                    autoPage: false
                });
            } else {
                sl.addText('No team members on record.', {
                    x: 0.50, y: tableY + 0.10, w: 9.0,
                    fontSize: 9.5, color: '888888', italic: true, fontFace: 'Arial'
                });
            }

            if (overflow.length > 0) {
                const contPages = Math.ceil(overflow.length / MEMBERS_CONT);
                for (let cp = 0; cp < contPages; cp++) {
                    const batch = overflow.slice(cp * MEMBERS_CONT, (cp + 1) * MEMBERS_CONT);
                    const slc = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
                    this.addSlideHeader(pptx, slc, getTeamSlideLabel());

                    const subH = 0.30;
                    slc.addShape(pptx.ShapeType.rect, {
                        x: 0.35, y: CONTENT_Y, w: 9.25, h: subH,
                        fill: { color: '1A3A6B' }, line: { color: '1A3A6B' }
                    });
                    slc.addText(`${p.name} — Team Members (cont.)`, {
                        x: 0.50, y: CONTENT_Y + 0.04, w: 8.9, h: subH - 0.08,
                        fontSize: 10, bold: true, color: 'FFFFFF', fontFace: 'Arial', valign: 'middle'
                    });

                    const contRows = buildTable(batch);
                    slc.addTable(contRows, {
                        x: 0.35, y: CONTENT_Y + subH + 0.05, w: 9.25,
                        colW: [4.625, 4.625],
                        rowH: Array(contRows.length).fill(ROW_H),
                        border: { color: 'D0DAF0', pt: 1 },
                        autoPage: false
                    });
                }
            }
        });
    }

    private addThankYouSlide(pptx: PptxGenJS): void {
        const slideEnd = pptx.addSlide({ masterName: 'MASTER_THANKYOU' });
        slideEnd.addText('Thank You', {
            x: 0.5, y: 2.2, w: 3.5, h: 1.0,
            fontSize: 40, color: '333333', fontFace: 'Arial'
        });
        slideEnd.addText('Silicon Valley | Los Angeles | Chicago | New York | Mumbai', {
            x: 0.5, y: 4.8, w: 3.5, h: 0.3,
            fontSize: 9, color: '666666', bold: true, fontFace: 'Arial'
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Style + layout primitives
    // ─────────────────────────────────────────────────────────────

    /**
     * Applies the period-appropriate section header and returns the y at which
     * content may start. Weekly keeps the plain navy title; monthly gets the
     * header band + orange stripe.
     */
    private applySectionHeader(pptx: PptxGenJS, slide: any, deck: DeckData, title: string, suffix = ''): number {
        if (deck.period === 'monthly') {
            this.addSlideHeader(pptx, slide, title, suffix);
            return 0.82;
        }
        slide.addText(`${title}${suffix}`, {
            x: 0.5, y: 0.3, w: 9.0, fontSize: 24, bold: true, color: '003366', fontFace: 'Arial'
        });
        return 0.9;
    }

    /** Navy header band + orange stripe (monthly style). */
    private addSlideHeader(pptx: PptxGenJS, slide: any, title: string, suffix = ''): void {
        slide.addShape(pptx.ShapeType.rect, {
            x: 0, y: 0, w: 9.25, h: 0.62,
            fill: { color: '003366' }, line: { color: '003366' }
        });
        slide.addShape(pptx.ShapeType.rect, {
            x: 0, y: 0.62, w: 9.25, h: 0.025,
            fill: { color: 'F47920' }, line: { color: 'F47920' }
        });
        slide.addText(`${title}${suffix}`, {
            x: 0.4, y: 0, w: 8.7, h: 0.62,
            fontSize: 20, bold: true, color: 'FFFFFF', valign: 'middle', fontFace: 'Arial'
        });
    }

    /** Health badge inside the monthly header band, clear of the logo at x:9.5. */
    private addHealthBadge(pptx: PptxGenJS, slide: any, health: string): void {
        const healthColorMap: Record<string, string> = { green: '4CAF50', amber: 'FF9800', red: 'F44336' };
        const healthColor = healthColorMap[(health || '').toLowerCase()] || '888888';
        const healthLabel = (health || 'N/A').charAt(0).toUpperCase() + (health || '').slice(1).toLowerCase();

        slide.addShape(pptx.ShapeType.rect, {
            x: 7.25, y: 0.09, w: 1.9, h: 0.44,
            fill: { color: healthColor }, line: { color: healthColor }
        });
        slide.addText(healthLabel, {
            x: 7.25, y: 0.09, w: 1.9, h: 0.44,
            fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: 'Arial'
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Scaffolding
    // ─────────────────────────────────────────────────────────────

    private resolveAssetsPath(): string {
        const possiblePaths = [
            path.join(process.cwd(), 'src/assets'),
            path.join(process.cwd(), 'backend/src/assets'),
            path.join(__dirname, '../../assets')
        ];

        for (const p of possiblePaths) {
            // Directory must exist AND contain a key file (image1.png) to be valid
            if (fs.existsSync(p) && fs.existsSync(path.join(p, 'image1.png'))) return p;
        }

        console.warn('Warning: Assets folder with image1.png not found. Falling back to default if possible.');
        const finalFallback = path.join(process.cwd(), 'backend/src/assets');
        if (fs.existsSync(path.join(finalFallback, 'image1.png'))) return finalFallback;

        console.error('Critical Error: Assets folder still not found.');
        return '';
    }

    private defineMasters(pptx: PptxGenJS, assetsPath: string): void {
        const getGeometricMasterObjects = (bgImageName: string) => {
            const objs: any[] = [];

            if (assetsPath) {
                objs.push({
                    image: {
                        x: 0, y: 0, w: '100%', h: '100%',
                        path: path.join(assetsPath, bgImageName),
                        sizing: { type: 'cover', w: '100%', h: '100%' }
                    }
                });
            }

            const whiteWidth = 4.5;
            objs.push({ rect: { x: 0, y: 0, w: whiteWidth, h: 5.625, fill: 'FFFFFF' } });
            objs.push({
                shape: pptx.ShapeType.rtTriangle,
                x: whiteWidth, y: 0, w: 2.0, h: 5.625,
                fill: 'FFFFFF',
                flipH: true
            });
            objs.push({
                shape: pptx.ShapeType.rtTriangle,
                x: whiteWidth + 2.0, y: 3.5, w: 2.125, h: 2.125,
                fill: 'F9CB9C',
                flipH: true
            });
            objs.push({
                shape: pptx.ShapeType.rect,
                x: 0, y: 3.2, w: 0.6, h: 0.4,
                fill: 'E06666'
            });

            return objs;
        };

        pptx.defineSlideMaster({
            title: 'MASTER_TITLE',
            background: { color: 'FFFFFF' },
            objects: getGeometricMasterObjects('image30.png')
        });

        pptx.defineSlideMaster({
            title: 'MASTER_CONTENT',
            background: { color: 'FFFFFF' },
            margin: [0.5, 0.5, 0.5, 0.5],
            objects: [
                ...(assetsPath ? [{
                    image: {
                        x: 9.5, y: 0.1, w: 0.35, h: 0.35,
                        path: path.join(assetsPath, 'image1.png'),
                        sizing: { type: 'contain', w: 0.35, h: 0.35 }
                    }
                }] : []),
                { rect: { x: 0.5, y: 5.15, w: 1.2, h: 0.08, fill: 'F47920' } },
                { rect: { x: 1.8, y: 5.18, w: 7.7, h: 0.02, fill: '003366' } }
            ] as any[]
        });

        pptx.defineSlideMaster({
            title: 'MASTER_THANKYOU',
            background: { color: 'FFFFFF' },
            objects: getGeometricMasterObjects('image29.jpeg')
        });
    }

    /**
     * True when filePath was produced by the current deck layout. Used by the
     * download endpoints to decide whether to serve as-is or re-render.
     */
    isDeckCurrent(filePath?: string | null): boolean {
        if (!filePath) return false;
        return path.basename(filePath).endsWith(`_${DECK_TEMPLATE_VERSION}.pptx`);
    }

    /** Filename without the internal version suffix, for the user-facing download. */
    friendlyDeckName(filePath: string): string {
        return path.basename(filePath).replace(`_${DECK_TEMPLATE_VERSION}.pptx`, '.pptx');
    }

    private deckFileName(deck: DeckData): string {
        const saneName = deck.entityName.replace(/[^a-z0-9]/gi, '_');
        const prefix = deck.scope === 'program' ? 'Program' : 'Account';
        const stem = deck.period === 'monthly'
            ? `${prefix}_Monthly_Status_${saneName}_${deck.month}_${deck.year}`
            : `${prefix}_Status_${saneName}_${deck.startDate}_${deck.endDate}`;
        return `${stem}_${DECK_TEMPLATE_VERSION}.pptx`;
    }

    private async saveDeck(pptx: PptxGenJS, fileName: string): Promise<string> {
        const reportsDir = config.reports.path || path.join(process.cwd(), 'reports');
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

        const filePath = path.join(reportsDir, fileName);
        try {
            await pptx.writeFile({ fileName: filePath });
            console.log(`PPT Generated: ${filePath}`);
            return filePath;
        } catch (err) {
            console.error('Failed to write PPT file', err);
            throw err;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Content shaping
    // ─────────────────────────────────────────────────────────────

    private normalizeRisks(risks: DeckData['risks']): { summary: string; items: string[] } {
        if (risks && typeof risks === 'object' && !Array.isArray(risks)) {
            const r = risks as { summary: string; items: string[] };
            return { summary: r.summary || '', items: Array.isArray(r.items) ? r.items : [] };
        }
        if (Array.isArray(risks)) return { summary: '', items: risks };
        if (typeof risks === 'string' && risks) return { summary: '', items: [risks] };
        return { summary: '', items: [] };
    }

    /**
     * Collapses AI bullets of the form "[Project Name]: text" into one bullet per
     * project, preserving first-seen order (the AI orders by priority).
     *
     * Unprefixed items are account/program-wide and are emitted individually —
     * merging unrelated cross-cutting statements into one bullet would be wrong.
     * Single-project reports emit no prefix at all, so everything falls through
     * this path untouched.
     */
    private groupItemsByProject(items: string[], knownProjects: string[]): string[] {
        if (!Array.isArray(items) || items.length === 0) return [];

        const canonical = (label: string): string => {
            const l = label.trim().toLowerCase();
            const exact = knownProjects.find(p => p.trim().toLowerCase() === l);
            if (exact) return exact;
            const partial = knownProjects.find(p => {
                const pl = p.trim().toLowerCase();
                return pl.length > 0 && (pl.includes(l) || l.includes(pl));
            });
            // Keep an unmatched label as its own group rather than demoting it to
            // general — that would drop attribution the AI intended.
            return partial || label.trim();
        };

        const groups = new Map<string, string[]>();
        const slots: Array<{ kind: 'general'; text: string } | { kind: 'project'; key: string }> = [];

        for (const raw of items) {
            if (!raw) continue;
            const norm = this.stripMarkdown(String(raw)).replace(/^[-•*▶■]\s*/, '').trim();
            if (!norm) continue;

            // The colon is optional: the AI emits both "[Project]: text" and
            // "[Project] text" in practice, and both must group by project.
            const m = norm.match(/^\[([^\]]{1,80})\]\s*:?\s*([\s\S]+)$/);
            if (!m) {
                slots.push({ kind: 'general', text: norm });
                continue;
            }

            const key = canonical(m[1]);
            if (!groups.has(key)) {
                groups.set(key, []);
                slots.push({ kind: 'project', key });
            }
            groups.get(key)!.push(m[2].trim());
        }

        const out: string[] = [];
        for (const slot of slots) {
            if (slot.kind === 'general') {
                out.push(slot.text);
                continue;
            }
            const bodies = (groups.get(slot.key) || [])
                .map(b => b.replace(/\.\s*$/, '').trim())
                .filter(Boolean);
            if (bodies.length === 0) continue;
            // These merged items become one of paginateBullets' "items" downstream, each
            // re-truncated to PLAIN_BULLET_ITEM_CHARS at render time -- kept at least that large
            // here so this pre-merge cap never cuts before the render-time cap does.
            out.push(this.truncate(`[${slot.key}]: ${bodies.join('; ')}`, PLAIN_BULLET_ITEM_CHARS + 20));
        }
        return out;
    }

    /**
     * Groups bullet items into slides by an estimated wrapped-line budget, so each
     * slide fills before spilling to the next. `firstPageBudget` lets the first
     * slide reserve room for a summary box.
     */
    private paginateBullets(items: string[], firstPageBudget = PLAIN_LINE_BUDGET): string[][] {
        const pages: string[][] = [];
        let cur: string[] = [];
        let used = 0;
        const budgetFor = (pageIdx: number) => (pageIdx === 0 ? firstPageBudget : PLAIN_LINE_BUDGET);

        for (const item of items) {
            const estChars = Math.min(item.length, PLAIN_BULLET_ITEM_CHARS); // items are truncated to this when drawn
            const lines = Math.max(1, Math.ceil(estChars / PLAIN_CHARS_PER_LINE));
            if (cur.length > 0 && used + lines > budgetFor(pages.length)) {
                pages.push(cur);
                cur = [];
                used = 0;
            }
            cur.push(item);
            used += lines;
        }
        if (cur.length > 0) pages.push(cur);
        return pages.length ? pages : [[]];
    }

    /** Renders bullet items across plain (weekly-style) slides, packed by line budget. */
    private addPlainBulletSlides(pptx: PptxGenJS, deck: DeckData, heading: string, items: string[], emptyText?: string): void {
        const pages = this.paginateBullets(items);
        pages.forEach((pageItems, i) => {
            const slide = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
            const suffix = pages.length > 1 ? ` (${i + 1}/${pages.length})` : '';
            const contentY = this.applySectionHeader(pptx, slide, deck, heading, suffix);

            if (pageItems.length === 0) {
                if (emptyText) {
                    slide.addText(emptyText, {
                        x: 0.5, y: 2.5, w: 9.0, fontSize: 14, color: '888888', fontFace: 'Arial', italic: true, align: 'center'
                    });
                }
                return;
            }

            slide.addText(pageItems.map(item => ({
                text: this.truncate(item, PLAIN_BULLET_ITEM_CHARS),
                options: { bullet: true, breakLine: true, paraSpaceBefore: 6, fontSize: 10, fontFace: 'Arial', lineSpacing: 16 }
            })), {
                x: 0.5, y: contentY, w: 9.0, h: Math.max(0.5, 4.9 - contentY),
                align: 'left', color: '333333', valign: 'top'
            });
        });
    }

    async generateProjectWeeklyReport(data: {
        projectName: string;
        weekNumber: number;
        year: number;
        startDate: string;
        endDate: string;
        executiveSummary: string;
        workSummary: string;
        achievements: string;
        risks: string;
        status: string;
        teamMembers?: string[];
    }): Promise<string> {
        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_16x9';

        const possiblePaths = [
            path.join(process.cwd(), 'src/assets'),
            path.join(process.cwd(), 'backend/src/assets'),
            path.join(__dirname, '../../assets')
        ];

        let assetsPath = '';
        for (const p of possiblePaths) {
            if (fs.existsSync(p) && fs.existsSync(path.join(p, 'image1.png'))) {
                assetsPath = p;
                break;
            }
        }
        if (!assetsPath) {
            const finalFallback = path.join(process.cwd(), 'backend/src/assets');
            if (fs.existsSync(path.join(finalFallback, 'image1.png'))) assetsPath = finalFallback;
        }

        const getGeometricMasterObjects = (bgImageName: string) => {
            const objs: any[] = [];
            if (assetsPath) {
                objs.push({ image: { x: 0, y: 0, w: '100%', h: '100%', path: path.join(assetsPath, bgImageName), sizing: { type: 'cover', w: '100%', h: '100%' } } });
            }
            const whiteWidth = 4.5;
            objs.push({ rect: { x: 0, y: 0, w: whiteWidth, h: 5.625, fill: 'FFFFFF' } });
            objs.push({ shape: pptx.ShapeType.rtTriangle, x: whiteWidth, y: 0, w: 2.0, h: 5.625, fill: 'FFFFFF', flipH: true });
            objs.push({ shape: pptx.ShapeType.rtTriangle, x: whiteWidth + 2.0, y: 3.5, w: 2.125, h: 2.125, fill: 'F9CB9C', flipH: true });
            objs.push({ shape: pptx.ShapeType.rect, x: 0, y: 3.2, w: 0.6, h: 0.4, fill: 'E06666' });
            return objs;
        };

        pptx.defineSlideMaster({
            title: 'MASTER_TITLE',
            background: { color: 'FFFFFF' },
            objects: getGeometricMasterObjects('image30.png')
        });
        pptx.defineSlideMaster({
            title: 'MASTER_CONTENT',
            background: { color: 'FFFFFF' },
            margin: [0.5, 0.5, 0.5, 0.5],
            objects: [
                ...(assetsPath ? [{ image: { x: 9.5, y: 0.1, w: 0.35, h: 0.35, path: path.join(assetsPath, 'image1.png'), sizing: { type: 'contain', w: 0.35, h: 0.35 } } }] : []),
                { rect: { x: 0.5, y: 5.15, w: 1.2, h: 0.08, fill: 'F47920' } },
                { rect: { x: 1.8, y: 5.18, w: 7.7, h: 0.02, fill: '003366' } }
            ] as any[]
        });
        pptx.defineSlideMaster({
            title: 'MASTER_THANKYOU',
            background: { color: 'FFFFFF' },
            objects: getGeometricMasterObjects('image29.jpeg')
        });

        // Slide 1: Title
        const slide1 = pptx.addSlide({ masterName: 'MASTER_TITLE' });
        slide1.addText('Weekly Project Update', { x: 0.5, y: 3.0, w: 4.0, h: 0.6, fontSize: 22, color: '666666', fontFace: 'Arial' });
        slide1.addText(data.projectName, { x: 0.5, y: 3.7, w: 4.0, h: 0.7, fontSize: 32, bold: true, color: '333333', fontFace: 'Arial' });
        slide1.addText(`${data.startDate} - ${data.endDate}  |  Week ${data.weekNumber}, ${data.year}`, { x: 0.5, y: 4.5, w: 4.0, h: 0.4, fontSize: 13, color: '666666', fontFace: 'Arial' });

        // Slide 2: Agenda
        const slideAgenda = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
        slideAgenda.addText('Agenda', { x: 0.5, y: 0.3, w: 9.0, fontSize: 24, bold: true, color: '003366', fontFace: 'Arial' });
        const agendaItems: any[] = [
            { text: 'Executive Summary', options: { bullet: true, breakLine: true } },
            { text: 'Work Summary', options: { bullet: true, breakLine: true } },
            { text: 'Achievements', options: { bullet: true, breakLine: true } },
            { text: 'Key Risks', options: { bullet: true } }
        ];
        if (data.teamMembers && data.teamMembers.length > 0) {
            agendaItems.push({ text: 'Team Members', options: { bullet: true } });
        }
        slideAgenda.addText(agendaItems, { x: 0.5, y: 1.0, w: 9.0, h: 3.5, fontSize: 18, color: '333333', fontFace: 'Arial', lineSpacing: 36 });

        // Helper: split long text into bullet lines (split on newline or sentence boundaries)
        const toBulletLines = (text: string): string[] =>
            (text || '').split('\n').map(l => this.stripMarkdown(l.trim())).filter(l => l.length > 0);

        // Helper: add a paginated content slide (title + bullet lines, 6 per slide)
        const addPaginatedSlide = (slideTitle: string, lines: string[], linesPerSlide = 6) => {
            const totalPgs = Math.ceil(Math.max(lines.length, 1) / linesPerSlide);
            for (let i = 0; i < totalPgs; i++) {
                const s = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
                const suffix = totalPgs > 1 ? ` (${i + 1}/${totalPgs})` : '';
                s.addText(`${slideTitle}${suffix}`, {
                    x: 0.5, y: 0.3, w: 9.0, h: 0.5,
                    fontSize: 22, bold: true, color: '003366', fontFace: 'Arial'
                });
                const slice = lines.slice(i * linesPerSlide, (i + 1) * linesPerSlide);
                if (slice.length > 0) {
                    s.addText(
                        slice.map(l => ({ text: l, options: { bullet: true, breakLine: true, paraSpaceBefore: 4 } })),
                        { x: 0.5, y: 1.0, w: 9.0, h: 4.0, fontSize: 11, color: '333333', fontFace: 'Arial', lineSpacing: 18, valign: 'top' }
                    );
                } else {
                    s.addText('No data available.', { x: 0.5, y: 1.0, w: 9.0, fontSize: 11, color: '888888', fontFace: 'Arial' });
                }
            }
        };

        // Slide 3: Executive Summary
        const healthColor = this.getHealthColor(data.status);
        const healthLabel = (data.status || 'Unknown').toUpperCase();
        const slideExec = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
        // Title — narrowed to leave room for health badge on the right
        slideExec.addText('Executive Summary', {
            x: 0.5, y: 0.28, w: 7.0, h: 0.55,
            fontSize: 22, bold: true, color: '003366', fontFace: 'Arial'
        });
        // Health badge: inline with title, ends at x=9.3 (logo is at x=9.5, no overlap)
        slideExec.addShape(pptx.ShapeType.rect, {
            x: 7.7, y: 0.28, w: 1.6, h: 0.42,
            fill: { color: healthColor }, line: { color: healthColor }
        });
        slideExec.addText(healthLabel, {
            x: 7.7, y: 0.28, w: 1.6, h: 0.42,
            fontSize: 11, bold: true, color: 'FFFFFF',
            align: 'center', valign: 'middle', fontFace: 'Arial'
        });
        // Body — starts at y=1.0, well clear of the title row
        slideExec.addText(
            this.stripMarkdown(data.executiveSummary || 'No summary available.'),
            { x: 0.5, y: 1.0, w: 9.0, h: 4.0, fontSize: 12, align: 'justify', color: '333333', fontFace: 'Arial', lineSpacing: 22 }
        );

        // Slides 4+: Work Summary — paginated, 6 bullets per slide
        addPaginatedSlide('Work Summary', toBulletLines(data.workSummary || 'No work summary available.'));

        // Slides n+: Achievements — paginated
        addPaginatedSlide('Achievements', toBulletLines(data.achievements || 'No achievements recorded.'));

        // Slides n+: Key Risks — paginated (same helper, same safe layout)
        addPaginatedSlide('Key Risks', toBulletLines(data.risks || '').length > 0 ? toBulletLines(data.risks || '') : ['No critical risks reported.']);

        // Slide 6 (optional): Team Members
        if (data.teamMembers && data.teamMembers.length > 0) {
            const slideTeam = pptx.addSlide({ masterName: 'MASTER_CONTENT' });
            slideTeam.addText('Team Members', { x: 0.5, y: 0.3, w: 9.0, fontSize: 24, bold: true, color: '003366', fontFace: 'Arial' });
            const teamRows: any[] = [[
                { text: 'Name', options: { bold: true, fill: '003366', color: 'FFFFFF', fontFace: 'Arial', fontSize: 11 } },
                { text: 'Role', options: { bold: true, fill: '003366', color: 'FFFFFF', fontFace: 'Arial', fontSize: 11 } }
            ]];
            data.teamMembers.forEach((m, idx) => {
                const fill = idx % 2 === 0 ? 'F2F2F2' : 'FFFFFF';
                if (typeof m === 'object' && (m as any).name) {
                    teamRows.push([
                        { text: (m as any).name, options: { fill, fontSize: 10, fontFace: 'Arial' } },
                        { text: (m as any).role || '', options: { fill, fontSize: 10, fontFace: 'Arial' } }
                    ]);
                } else {
                    teamRows.push([
                        { text: String(m), options: { fill, fontSize: 10, fontFace: 'Arial' } },
                        { text: '', options: { fill, fontSize: 10, fontFace: 'Arial' } }
                    ]);
                }
            });
            slideTeam.addTable(teamRows, { x: 0.5, y: 0.9, w: 9.0, colW: [4.5, 4.5], border: { color: 'CCCCCC', pt: 1 } });
        }

        // Final Slide: Thank You
        const slideEnd = pptx.addSlide({ masterName: 'MASTER_THANKYOU' });
        slideEnd.addText('Thank You', { x: 0.5, y: 2.2, w: 3.5, h: 1.0, fontSize: 40, color: '333333', fontFace: 'Arial' });
        slideEnd.addText('Silicon Valley | Los Angeles | Chicago | New York | Mumbai', { x: 0.5, y: 4.8, w: 3.5, h: 0.3, fontSize: 9, color: '666666', bold: true, fontFace: 'Arial' });

        const reportsDir = config.reports.path || path.join(process.cwd(), 'reports');
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

        const saneName = data.projectName.replace(/[^a-z0-9]/gi, '_');
        const fileName = `Project_Weekly_Report_${saneName}_${data.startDate}_${data.endDate}.pptx`;
        const filePath = path.join(reportsDir, fileName);

        try {
            await pptx.writeFile({ fileName: filePath });
            console.log(`Project PPT Generated: ${filePath}`);
            return filePath;
        } catch (err) {
            console.error('Failed to write project weekly PPT', err);
            throw err;
        }
    }

    private stripMarkdown(text: string): string {
        if (!text) return '';
        return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*\*/g, '');
    }

    /**
     * Truncate to maxChars without cutting a sentence off mid-way and without an ellipsis or any
     * other trailing marker -- a clean, quiet stop. Tries, in order:
     *   1. the last real sentence terminator (. ! ?) at or before maxChars -- the text ends on a
     *      genuine sentence boundary;
     *   2. the last clause boundary (; or ,) at or before maxChars -- risks/achievements bullets
     *      are often semicolon-joined clauses with no terminal punctuation at all, so tier 1 never
     *      fires for them;
     *   3. the last word boundary, with nothing appended -- for text with no punctuation to cut
     *      at all. Whatever doesn't fit is simply not shown, rather than flagged as cut off with
     *      an ellipsis or a pointer elsewhere (a prior "see following slide" marker + dedicated
     *      overflow slide was tried and removed: pptxgenjs's own row-pagination height estimate
     *      could silently drop that marker from a row landing near a page boundary in a real
     *      multi-row table, making the signal itself unreliable).
     * Never cuts past maxChars.
     */
    private truncate(text: string, maxChars: number): string {
        if (!text || text.length <= maxChars) return text || '';
        const cut = text.slice(0, maxChars);

        const sentenceEnd = this.lastSentenceBoundary(cut);
        if (sentenceEnd > maxChars * 0.3) {
            return text.slice(0, sentenceEnd).trim();
        }

        const lastClause = Math.max(cut.lastIndexOf(';'), cut.lastIndexOf(','));
        if (lastClause > maxChars * 0.5) {
            return text.slice(0, lastClause + 1).trim();
        }

        const lastSpace = cut.lastIndexOf(' ');
        return (lastSpace > maxChars * 0.7 ? cut.slice(0, lastSpace) : cut).trim();
    }

    /**
     * Index just past the last genuine sentence-ending punctuation in `cut` (or -1 if none).
     * "Genuine" means followed by whitespace + a capital/digit/quote (the start of a new
     * sentence) or by the end of the string -- the same lookahead used by
     * perfAggregation.ts's splitNarrativeToBullets to split narratives into sentences, applied
     * here to find a cut point instead. This is what keeps a decimal like "6.2" from being
     * mistaken for a sentence end (no whitespace follows the dot).
     *
     * Separately, a `.` followed by whitespace + a digit/capital also matches common
     * abbreviations ("vs. 3 previous week", "Inc. is a subsidiary") -- found via a real cut that
     * stopped at "...tickets vs." Any match immediately preceded by a known non-terminal
     * abbreviation is skipped, so the scan keeps looking for an earlier, genuine boundary instead.
     */
    private lastSentenceBoundary(cut: string): number {
        const re = /[.!?](?=\s+[A-Z0-9"'([]|$)/g;
        let best = -1;
        let m: RegExpExecArray | null;
        while ((m = re.exec(cut)) !== null) {
            if (m[0] === '.' && this.endsWithAbbreviation(cut, m.index)) continue;
            best = m.index + 1;
        }
        return best;
    }

    /** True if the period at `periodIndex` in `text` immediately follows a known abbreviation. */
    private endsWithAbbreviation(text: string, periodIndex: number): boolean {
        const wordMatch = text.slice(0, periodIndex).match(/([A-Za-z]+)$/);
        return !!wordMatch && NON_TERMINAL_ABBREVIATIONS.has(wordMatch[1].toLowerCase());
    }

    private getHealthColor(health: string): string {
        switch (health?.toLowerCase()) {
            case 'green': return '008000';
            case 'amber': return 'FFA500';
            case 'red': return 'FF0000';
            default: return '666666';
        }
    }

    private parseMarkdown(text: string): { text: string; options?: { bold: boolean } }[] {
        if (!text) return [];
        return text.split(/(\*\*.*?\*\*)/g).map(part => {
            if (part.startsWith('**') && part.endsWith('**')) return { text: part.slice(2, -2), options: { bold: true } };
            return { text: part };
        }).filter(p => p.text !== '');
    }
}

export const pptGenerator = new PptGenerator();

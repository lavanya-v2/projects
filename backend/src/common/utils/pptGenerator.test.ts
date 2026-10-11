import { describe, it, expect } from 'vitest';
import { PptGenerator } from './pptGenerator';

// Build #12: the shared `truncate()` used across every PPT text cell (summaries, risks,
// achievements, annexure bullets) used to be a fixed word-boundary + ellipsis cut, which could
// (and, per real report review, did) cut a sentence off mid-way. `truncate` is private, so these
// tests reach it the same way the class's own methods do -- via an `any` cast on a real instance
// -- since introducing a public wrapper just for testability would be its own unneeded surface.
const gen = new PptGenerator() as unknown as { truncate: (text: string, maxChars: number) => string };

describe('PptGenerator.truncate — sentence-boundary-aware truncation (Build #12)', () => {
    it('leaves text under the budget untouched', () => {
        const text = 'Short status update for the week.';
        expect(gen.truncate(text, 260)).toBe(text);
    });

    it('cuts at the last full sentence when one exists before maxChars, with no ellipsis needed', () => {
        // Real WSR-style narrative shape: several complete sentences back to back.
        const text = 'Sprint velocity held steady at 32 points. Two production defects were resolved ahead of schedule. ' +
            'A third defect (SC-2502) remains open pending root cause analysis and is being tracked for next week.';
        const result = gen.truncate(text, 100);
        expect(result.endsWith('.')).toBe(true);
        expect(result).not.toMatch(/…$/);
        expect(text.startsWith(result)).toBe(true); // the cut is a genuine prefix, nothing altered
    });

    it('does not mistake a decimal number for a sentence boundary', () => {
        const text = 'Throughput declined 71% week-over-week while average active tickets increased from 3 to 4.2 overall.';
        const result = gen.truncate(text, 60);
        // "4.2" must not be treated as a sentence end just because a "." appears inside it.
        expect(result).not.toMatch(/4\.$/);
    });

    it('falls back to a clause boundary (semicolon) when there is no sentence terminator to cut at — real risks bullet with no terminal punctuation', () => {
        // Real DB example: semicolon/comma-joined clause, zero terminal punctuation anywhere.
        const text = 'SC-2502: Production bug affecting profile change error on card interface remains unresolved from previous sprint, currently in Dev Complete';
        const result = gen.truncate(text, 120); // the comma sits at index 112, inside this budget
        expect(result.length).toBeLessThanOrEqual(120);
        expect(result.endsWith(',')).toBe(true);
        expect(result).not.toMatch(/…$/);
    });

    it('falls back to a clean word-boundary cut, with nothing appended, when neither a sentence nor a clause boundary is available', () => {
        // A prior version appended an ellipsis here, and separately, a "(full text: see following
        // slide)" pointer to a dedicated overflow slide -- both removed after real regeneration
        // testing showed the pointer marker could be silently dropped by pptxgenjs's own
        // row-pagination height estimate for a row landing near a page boundary in a real
        // multi-row table, making the signal itself unreliable. Now: a clean, quiet stop only.
        const text = 'A'.repeat(50) + ' ' + 'B'.repeat(50) + ' ' + 'C'.repeat(50); // no punctuation at all
        const result = gen.truncate(text, 60);
        expect(result).not.toMatch(/…$/);
        expect(result).not.toContain('full text');
        expect(result.length).toBeLessThanOrEqual(60);
        expect(result.endsWith(' ')).toBe(false);
    });

    it('never returns text longer than maxChars', () => {
        const text = 'Eleven tickets stale in development beyond three days across Parks migration infrastructure work ' +
            'and multiple automation test suite implementations, representing potential velocity constraints. ' +
            'Retiree Health Insurance report defect investigation ongoing.';
        for (const max of [40, 80, 120, 200]) {
            const result = gen.truncate(text, max);
            expect(result.length).toBeLessThanOrEqual(max);
        }
    });

    it('real long multi-bullet risks string (CCMRPA example) truncates to a clean boundary, not mid-word, no ellipsis', () => {
        const text = 'CCMRPA-1396 (NMLS Licensing Phase 2 Requirement Analysis) blocked for 3 days (since 2026-09-09) with no resolution timeline. ' +
            'CCMRPA-1085 (Scheduled Bot Trigger) blocked for 3 days (since 2026-08-21). ' +
            'Nine appraisal ordering automation tickets blocked for 3 days (since 2026-09-15) requiring attention to maintain delivery velocity.';
        const result = gen.truncate(text, 150);
        // Must end at a real word/punctuation boundary, never inside a word, and never with an ellipsis.
        expect(result.endsWith(' ')).toBe(false);
        expect(result).not.toMatch(/…$/);
        expect(/\S$/.test(result)).toBe(true);
        expect(text.length).toBeGreaterThan(150); // sanity: this fixture actually exceeds the budget
    });
});

describe('PptGenerator.truncate — abbreviation false-positive fix', () => {
    // Real bug, found via a real cell that stopped at "...9 average active tickets vs." (LOSAI,
    // CCM week 39). "vs." followed by whitespace + a digit matched the sentence-boundary regex,
    // so the detector treated the abbreviation as a genuine (but false) sentence end.
    it('does not treat "vs." as a sentence end when followed by a number (real LOSAI risks text)', () => {
        const text = 'No critical blockers identified. Zero tickets currently blocked. Work volume increased substantially ' +
            '(9 average active tickets vs. 3 previous week) with no completions to Done status this week, suggesting work ' +
            'is accumulating in earlier workflow stages without flowing through to completion.';
        const result = gen.truncate(text, 200);
        expect(result).not.toMatch(/vs\.$/);
        // The two real, complete sentences before the false "vs." boundary should be used instead.
        expect(result).toBe('No critical blockers identified. Zero tickets currently blocked.');
    });

    it('does not treat "etc." as a sentence end when followed by a capitalized word', () => {
        const text = 'Reviewed logging, monitoring, alerting, etc. The team also completed the migration ahead of schedule this week.';
        const result = gen.truncate(text, 45);
        expect(result).not.toMatch(/etc\.$/);
    });

    it('still treats a real "." after a non-abbreviation word as a genuine sentence end', () => {
        const text = 'The migration completed successfully. Next steps are documented in the runbook for reference.';
        const result = gen.truncate(text, 50);
        expect(result).toBe('The migration completed successfully.');
    });

});

describe('PptGenerator.addProjectDetailsSlides — no overflow marker or dedicated slide (removed)', () => {
    // A prior version appended "(full text: see following slide)" to an overflowing Summary
    // cell and promoted that project to its own dedicated slide. Both were removed: the marker
    // was asymmetric (Risks cells never got one, even when Risks itself overflowed) and, per real
    // regeneration testing, could be silently dropped by pptxgenjs's own row-pagination height
    // estimate for a row landing near a page boundary -- an unreliable foundation. Truncation is
    // now the only mechanism, symmetric across both cells, with no pointer elsewhere.
    it('does not add an overflow marker to a long Summary cell, and adds no dedicated slide', () => {
        const genAny = new PptGenerator() as any;
        const longSummary = 'A'.repeat(800); // exceeds SUMM_CELL_CHARS (700), no punctuation to cut at

        const slidesAdded: any[] = [];
        const tables: any[] = [];
        const stubSlide = { addText: () => undefined, addTable: (data: any) => tables.push(data) };
        const stubPptx = { addSlide: () => { slidesAdded.push(1); return stubSlide; } };

        const deck = {
            period: 'weekly',
            projects: [{ name: 'TESTPROJ', status: 'Green', summary: longSummary, risks: 'Minor risk noted.' }],
            projectsMissing: []
        };

        genAny.addProjectDetailsSlides(stubPptx, deck);

        expect(slidesAdded).toHaveLength(1); // only the table slide, no dedicated overflow slide
        const dataRow = tables[0][1];
        const summaryCell = dataRow[2];
        const rendered = Array.isArray(summaryCell.text)
            ? summaryCell.text.map((run: any) => run.text).join('')
            : String(summaryCell.text);
        expect(rendered).not.toContain('full text');
        expect(rendered).not.toContain('[object Object]');
    });

    it('a long Risks cell is truncated the same way, with no marker either (symmetric with Summary)', () => {
        const genAny = new PptGenerator() as any;
        const longRisks = 'B'.repeat(700); // exceeds RISK_CELL_CHARS (550)

        const tables: any[] = [];
        const stubSlide = { addText: () => undefined, addTable: (data: any) => tables.push(data) };
        const stubPptx = { addSlide: () => stubSlide };

        const deck = {
            period: 'weekly',
            projects: [{ name: 'TESTPROJ', status: 'Amber', summary: 'All on track this week.', risks: longRisks }],
            projectsMissing: []
        };

        genAny.addProjectDetailsSlides(stubPptx, deck);

        const dataRow = tables[0][1];
        const risksCell = dataRow[3];
        const rendered = Array.isArray(risksCell.text)
            ? risksCell.text.map((run: any) => run.text).join('')
            : String(risksCell.text);
        expect(rendered).not.toContain('full text');
        expect(rendered.length).toBeLessThanOrEqual(550); // RISK_CELL_CHARS
    });
});

describe('PptGenerator — WordPress real week-39 case (budget too small for punctuation-free content)', () => {
    // Real DB text, week 39 2026: zero periods, commas, or semicolons anywhere -- under the old
    // 200-char RISK_CELL_CHARS budget this always fell to the word-boundary fallback ("...remains
    // in"). At the new 550-char budget the full real text fits without any truncation at all.
    it('the real WordPress risks text (235 chars, no punctuation) fits fully under the new budget', () => {
        const genAny = new PptGenerator() as any;
        const risks = '• WO-3211: Critical LO profile headline production bug requires QA validation before deployment\n' +
            '• WO-3031: Cloudflare authentication plugin development shows activity via commits but remains in progress beyond 3 days without completion';
        expect(risks.length).toBeLessThan(550);

        const tables: any[] = [];
        const stubSlide = { addText: () => undefined, addTable: (data: any) => tables.push(data) };
        const stubPptx = { addSlide: () => stubSlide };
        const deck = {
            period: 'weekly',
            projects: [{ name: 'WordPress', status: 'Amber', summary: 'Short summary.', risks }],
            projectsMissing: []
        };

        genAny.addProjectDetailsSlides(stubPptx, deck);

        const risksCell = tables[0][1][3];
        const rendered = Array.isArray(risksCell.text)
            ? risksCell.text.map((run: any) => run.text).join('')
            : String(risksCell.text);
        expect(rendered).toContain('remains in progress beyond 3 days without completion');
    });
});

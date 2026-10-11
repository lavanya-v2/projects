import Handlebars from 'handlebars';

const SMALL_WORDS = [
    'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
];

function numToWord(n: number): string {
    if (!Number.isFinite(n)) return String(n);
    const i = Math.trunc(n);
    if (i < 0) return String(n);
    if (i <= 20) return SMALL_WORDS[i];
    return String(i);
}

Handlebars.registerHelper('numWord', (value: unknown) => {
    const n = typeof value === 'number' ? value : parseInt(String(value));
    if (!Number.isFinite(n)) return String(value ?? '');
    return numToWord(n);
});

Handlebars.registerHelper('plural', (value: unknown, singular: string, plural: string) => {
    const n = typeof value === 'number' ? value : parseInt(String(value));
    return n === 1 ? singular : plural;
});

const cache = new Map<string, HandlebarsTemplateDelegate>();

function compile(template: string): HandlebarsTemplateDelegate {
    const cached = cache.get(template);
    if (cached) return cached;
    const compiled = Handlebars.compile(template, { noEscape: true });
    cache.set(template, compiled);
    return compiled;
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
    try {
        return compile(template)(context);
    } catch (err: any) {
        return `[template render error: ${err?.message || 'unknown'}]`;
    }
}

export function clearTemplateCache(): void {
    cache.clear();
}

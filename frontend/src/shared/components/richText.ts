/**
 * Shared helpers for the minimal rich text used by the Delivery Presentation
 * executive summary. Both the editor (RichTextEditor) and the renderer
 * (RichTextView) import from here so the two can never drift on what counts as
 * markup or how plain text is promoted to it.
 *
 * The stored value is one of two things: legacy/AI-generated plain text, or the
 * allowlisted HTML the editor emits. `toRichHtml` normalises both to markup, so
 * there is a single render path and no way for a tag or an entity to reach the
 * slide or the PDF as literal text.
 *
 * `looksLikeHtml` mirrors `isRichText` in backend/src/common/utils/richText.ts,
 * which decides whether a value gets sanitised on save.
 */

const HTML_RE = /<\s*(p|ul|ol|li|br|strong|em|u|b|i)\b[^>]*>/i;

export function looksLikeHtml(value: string): boolean {
    return HTML_RE.test(value);
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Converts plain text to paragraph markup. Blank lines separate paragraphs;
 * single newlines become breaks — the same rendering `whiteSpace: 'pre-wrap'`
 * used to give these values.
 */
export function plainToHtml(text: string): string {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return '';
    return paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** Normalises a stored summary — plain text or markup — to markup. */
export function toRichHtml(value: string | null | undefined): string {
    if (!value) return '';
    return looksLikeHtml(value) ? value : plainToHtml(value);
}

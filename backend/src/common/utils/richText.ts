import sanitizeHtml from 'sanitize-html';

/**
 * Helpers for the small subset of HTML we allow presenters to author in the
 * Delivery Presentation executive summary (bold / italic / underline / bullet
 * and numbered lists). Everything else is stripped.
 *
 * The field is stored in `portfolio_presentations.key_highlights->>'summary'`,
 * which historically held plain text. Both formats coexist: rows written before
 * the rich text editor shipped stay plain, and the renderers fall back to the
 * old pre-wrap behaviour for them. These helpers are format-agnostic so the
 * refresh-time "did the user edit this?" check works across both.
 */

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li'];

/** Tags that represent an actual formatting choice by the user, as opposed to
 *  the paragraph/line-break wrappers the editor emits for any plain text. */
const FORMATTING_TAG_RE = /<\s*(strong|b|em|i|u|ul|ol|li)\b[^>]*>/i;

/** Any markup the editor produces. Mirrors `looksLikeHtml` in
 *  frontend/src/shared/components/richText.ts. */
const RICH_TEXT_RE = /<\s*(p|ul|ol|li|br|strong|em|u|b|i)\b[^>]*>/i;

/** True when the value carries editor markup rather than being plain text —
 *  either a legacy summary or a freshly AI-generated one, both of which are
 *  stored as-is. */
export function isRichText(value: string | null | undefined): boolean {
    return !!value && RICH_TEXT_RE.test(value);
}

/**
 * Strips everything outside the allowlist. No attributes are permitted at all,
 * so no styles, classes, ids, event handlers or urls can be smuggled through.
 *
 * Plain text is returned untouched. sanitize-html entity-escapes `&`, `<` and
 * `>` unconditionally, which is right for markup and wrong for prose: an AI
 * summary reading "R&D ... was < 5%" would be stored as "R&amp;D ... was
 * &lt; 5%" and re-escaped on every subsequent save, compounding into
 * "&amp;amp;". Tags-free values are escaped by the renderer instead
 * (see frontend RichTextView), so passing them through is both safe and
 * lossless.
 */
export function sanitizeRichText(value: string | null | undefined): string {
    if (!value) return '';
    if (!isRichText(value)) return value;
    return sanitizeHtml(value, {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: {},
        // Drop the contents of anything dangerous rather than keeping its text.
        nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
    });
}

/**
 * Flattens a rich text (or plain text) value to comparable plain text: block
 * boundaries become newlines, tags are removed, entities are decoded, and
 * whitespace is normalised so two representations of the same prose compare
 * equal.
 *
 * Tag-stripping and entity-decoding are applied ONLY to values that actually
 * carry markup. Prose is full of bare comparison operators — "leakage was < 5%
 * and coverage > 80%" — and a blanket /<[^>]*>/ strip would silently delete
 * everything between them, making an unedited summary look rewritten.
 */
export function richTextToPlain(value: string | null | undefined): string {
    if (!value) return '';
    let text = value;
    if (isRichText(value)) {
        text = value
            .replace(/<\s*br\s*\/?\s*>/gi, '\n')
            .replace(/<\s*\/\s*(p|li|ul|ol)\s*>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&amp;/gi, '&');
    }
    return text
        .replace(/[ \t]+/g, ' ')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');
}

/**
 * True when the value carries formatting the user deliberately applied. A plain
 * paragraph the editor merely wrapped in <p> tags does not count.
 */
export function hasRichFormatting(value: string | null | undefined): boolean {
    if (!value) return false;
    return FORMATTING_TAG_RE.test(value);
}

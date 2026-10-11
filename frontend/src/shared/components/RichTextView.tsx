import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { toRichHtml } from './richText';

interface Props {
    value: string | null | undefined;
    /** Rendered when the value is empty. */
    placeholder?: string;
    /** Typography styles for the block — font size, line height, colour. */
    sx?: SxProps<Theme>;
}

/**
 * Renders an executive summary that may be either rich text (from
 * RichTextEditor) or legacy/AI-generated plain text.
 *
 * There is deliberately only ONE render path: plain text is escaped and wrapped
 * into paragraphs by `toRichHtml` first. An earlier two-branch version — markup
 * via innerHTML, plain text via a pre-wrap Typography — let the storage side and
 * the render side disagree about what a value was, which surfaced entities like
 * `R&amp;D` as literal text on the slide and in the PDF. With one path that
 * class of bug cannot occur.
 *
 * Markup is sanitised server-side against a strict allowlist on every write path
 * (backend/src/common/utils/richText.ts), so no attributes or scriptable tags
 * can reach this component.
 */
export default function RichTextView({ value, placeholder = '—', sx }: Props) {
    const html = toRichHtml(value) || toRichHtml(placeholder);

    return (
        <Box
            sx={{
                // Reproduce the vertical rhythm of the pre-wrap rendering these
                // values used to get: a blank line between paragraphs was
                // exactly one line-height, hence `1em` rather than a theme
                // spacing unit. Existing decks must not reflow — SlideScaler
                // auto-fits on scrollHeight and the PDF slicer treats this
                // block as atomic.
                '& p': { m: 0, mb: '1em' },
                '& p:last-child': { mb: 0 },
                '& ul, & ol': { my: 0.5, pl: 3 },
                '& li': { mb: 0.25 },
                '& li:last-child': { mb: 0 },
                ...sx,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

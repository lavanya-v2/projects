import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Box, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import { toRichHtml } from './richText';

/** Tags the backend allowlist accepts (see backend/src/common/utils/richText.ts).
 *  Anything else pasted in is unwrapped to its text content. */
const ALLOWED_PASTE_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li']);

/**
 * Strips pasted markup down to the allowlist, dropping every attribute. Keeps
 * lists and emphasis from other documents while discarding fonts, colours and
 * anything the server would reject anyway.
 */
function sanitizePastedHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walk = (node: Element) => {
        Array.from(node.children).forEach(child => {
            walk(child);
            const tag = child.tagName.toLowerCase();
            if (!ALLOWED_PASTE_TAGS.has(tag)) {
                child.replaceWith(...Array.from(child.childNodes));
                return;
            }
            Array.from(child.attributes).forEach(attr => child.removeAttribute(attr.name));
        });
    };
    walk(doc.body);
    return doc.body.innerHTML;
}

interface Props {
    label?: string;
    value: string | null | undefined;
    onChange: (html: string) => void;
    minRows?: number;
    disabled?: boolean;
}

/**
 * Minimal rich text editor — bold, italic, underline, bulleted and numbered
 * lists. Emits HTML restricted to the tags the backend allowlist accepts.
 *
 * Seeding the editor never fires onChange, so opening a form does not mark it
 * dirty and a legacy plain-text value stays byte-identical in state until the
 * user actually formats or types something.
 */
export default function RichTextEditor({ label, value, onChange, minRows = 3, disabled = false }: Props) {
    const editor = useEditor({
        editable: !disabled,
        extensions: [
            StarterKit.configure({
                // Only the five formatting actions the toolbar exposes are kept;
                // everything else would be stripped server-side anyway.
                heading: false,
                blockquote: false,
                code: false,
                codeBlock: false,
                horizontalRule: false,
                strike: false,
                link: false,
            }),
        ],
        content: toRichHtml(value),
        editorProps: {
            transformPastedHTML: sanitizePastedHtml,
            attributes: { style: `min-height: ${minRows * 1.5}em; outline: none;` },
        },
        onUpdate: ({ editor: e }) => {
            // Tiptap renders an empty document as <p></p>; normalise that to ''
            // so an emptied field is stored as empty rather than stray markup.
            onChange(e.isEmpty ? '' : e.getHTML());
        },
    });

    // Reflect external replacements of the value (e.g. the AI preview pull
    // overwrites keyHighlights wholesale). emitUpdate: false keeps this from
    // registering as a user edit.
    useEffect(() => {
        if (!editor) return;
        const next = toRichHtml(value);
        const current = editor.isEmpty ? '' : editor.getHTML();
        if (next !== current) {
            editor.commands.setContent(next, { emitUpdate: false });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, editor]);

    useEffect(() => {
        editor?.setEditable(!disabled);
    }, [editor, disabled]);

    const isActive = (name: string, attrs?: Record<string, unknown>) => !!editor?.isActive(name, attrs);

    return (
        <Box>
            {label && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {label}
                </Typography>
            )}
            <Box
                sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    '&:focus-within': { borderColor: 'primary.main', boxShadow: theme => `0 0 0 1px ${theme.palette.primary.main}` },
                }}
            >
                <ToggleButtonGroup
                    size="small"
                    sx={{
                        p: 0.5,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        flexWrap: 'wrap',
                        '& .MuiToggleButton-root': { border: 0, borderRadius: 1, px: 1, py: 0.25 },
                    }}
                >
                    <Tooltip title="Bold">
                        <ToggleButton
                            value="bold" selected={isActive('bold')} disabled={disabled}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => editor?.chain().focus().toggleBold().run()}>
                            <FormatBoldIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                    <Tooltip title="Italic">
                        <ToggleButton
                            value="italic" selected={isActive('italic')} disabled={disabled}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => editor?.chain().focus().toggleItalic().run()}>
                            <FormatItalicIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                    <Tooltip title="Underline">
                        <ToggleButton
                            value="underline" selected={isActive('underline')} disabled={disabled}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => editor?.chain().focus().toggleUnderline().run()}>
                            <FormatUnderlinedIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                    <Tooltip title="Bulleted list">
                        <ToggleButton
                            value="bulletList" selected={isActive('bulletList')} disabled={disabled}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => editor?.chain().focus().toggleBulletList().run()}>
                            <FormatListBulletedIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                    <Tooltip title="Numbered list">
                        <ToggleButton
                            value="orderedList" selected={isActive('orderedList')} disabled={disabled}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
                            <FormatListNumberedIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                </ToggleButtonGroup>

                <Box
                    sx={{
                        px: 1.75, py: 1,
                        fontSize: '1rem',
                        lineHeight: 1.5,
                        cursor: disabled ? 'default' : 'text',
                        opacity: disabled ? 0.6 : 1,
                        '& .ProseMirror': { outline: 'none' },
                        '& .ProseMirror p': { m: 0, mb: 1 },
                        '& .ProseMirror p:last-child': { mb: 0 },
                        '& .ProseMirror ul, & .ProseMirror ol': { my: 0.5, pl: 3 },
                        '& .ProseMirror li': { mb: 0.25 },
                    }}
                    onClick={() => editor?.chain().focus().run()}
                >
                    <EditorContent editor={editor} />
                </Box>
            </Box>
        </Box>
    );
}

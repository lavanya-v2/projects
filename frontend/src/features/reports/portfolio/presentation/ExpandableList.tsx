import { useState, type ReactNode } from 'react';
import {
  Box, Typography, Stack, Button, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { useFullscreenContainer } from './FullscreenContainerContext';

interface ExpandableListProps {
  items: string[];
  max?: number;
  bulletChar?: string;
  bulletColor?: string;
  groupByProject?: boolean;
  emptyText?: string;
  modalTitle?: string;
}

interface ParsedItem {
  project: string | null;
  text: string;
}

const PROJECT_PREFIX_RE = /^\s*\[([^\]]+)\]\s*[-:•]?\s*(.*)$/s;

function parseItems(items: string[]): ParsedItem[] {
  return items.map(raw => {
    const trimmed = String(raw ?? '').trim();
    const m = PROJECT_PREFIX_RE.exec(trimmed);
    if (m && m[2]) return { project: m[1].trim(), text: m[2].trim() };
    return { project: null, text: trimmed };
  });
}

function groupItems(parsed: ParsedItem[]): Array<{ project: string | null; items: string[] }> {
  const order: Array<string | null> = [];
  const map = new Map<string | null, string[]>();
  for (const p of parsed) {
    if (!map.has(p.project)) {
      order.push(p.project);
      map.set(p.project, []);
    }
    map.get(p.project)!.push(p.text);
  }
  return order.map(project => ({ project, items: map.get(project)! }));
}

function renderFlat(items: string[], bulletChar: string, bulletColor: string): ReactNode {
  return (
    <Stack spacing={0.75}>
      {items.map((t, i) => (
        <Typography
          key={i}
          variant="body2"
          sx={{
            lineHeight: 1.6,
            '&::before': {
              content: `"${bulletChar} "`,
              color: bulletColor,
              fontWeight: 700,
            },
          }}
        >
          {t}
        </Typography>
      ))}
    </Stack>
  );
}

// Stable color rotation per project so the same project gets the same accent
// across achievements, blockers, action items - reinforces "this is one project".
export const PROJECT_ACCENTS = ['#1565c0', '#2e7d32', '#6a1b9a', '#e65100', '#00695c', '#c62828', '#455a64'];
export function projectAccent(name: string | null, fallback: string): string {
  if (!name) return fallback;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_ACCENTS[h % PROJECT_ACCENTS.length];
}

function renderGrouped(
  groups: Array<{ project: string | null; items: string[] }>,
  bulletChar: string,
  bulletColor: string,
): ReactNode {
  return (
    <Stack spacing={1}>
      {groups.map((g, gi) => {
        const accent = projectAccent(g.project, bulletColor);
        return (
          <Box
            key={gi}
            sx={{
              borderLeft: `3px solid ${accent}`,
              bgcolor: 'rgba(0,0,0,0.015)',
              borderRadius: '0 4px 4px 0',
              pl: 1.25,
              py: 0.5,
              pr: 0.5,
            }}
          >
            <Typography
              sx={{
                fontSize: 12,
                fontWeight: 700,
                color: accent,
                lineHeight: 1.3,
                mb: 0.25,
              }}
            >
              {g.project ?? 'Other'}
            </Typography>
            <Stack spacing={0.25}>
              {g.items.map((t, i) => (
                <Typography
                  key={i}
                  variant="body2"
                  sx={{
                    lineHeight: 1.5,
                    '&::before': {
                      content: `"${bulletChar} "`,
                      color: bulletColor,
                      fontWeight: 700,
                    },
                  }}
                >
                  {t}
                </Typography>
              ))}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

/**
 * Renders top-N items inline; if more, exposes a "View all (N)" button that
 * opens a dialog with the full list. With groupByProject, items prefixed
 * "[ProjectName] text" are grouped under one header per project.
 */
export function ExpandableList({
  items,
  max = 4,
  bulletChar = '•',
  bulletColor = '#1565c0',
  groupByProject = false,
  emptyText,
  modalTitle = 'Full list',
}: ExpandableListProps) {
  const [open, setOpen] = useState(false);
  const container = useFullscreenContainer();

  if (!items || items.length === 0) {
    return emptyText ? <Typography variant="body2" color="text.secondary">{emptyText}</Typography> : null;
  }

  const inline = items.slice(0, max);
  const overflow = Math.max(0, items.length - max);

  const inlineNode = groupByProject
    ? renderGrouped(groupItems(parseItems(inline)), bulletChar, bulletColor)
    : renderFlat(inline, bulletChar, bulletColor);

  const fullNode = groupByProject
    ? renderGrouped(groupItems(parseItems(items)), bulletChar, bulletColor)
    : renderFlat(items, bulletChar, bulletColor);

  return (
    <>
      {inlineNode}
      {overflow > 0 && (
        <Button
          size="small"
          variant="text"
          onClick={() => setOpen(true)}
          sx={{ mt: 1, alignSelf: 'flex-start', textTransform: 'none', fontWeight: 600 }}
        >
          View all ({items.length})
        </Button>
      )}
      {/*
        z-index 1500 is above PortfolioPresentation's full-screen container (1400).
        Default MUI Dialog (1300) would render BEHIND the slide deck and look like
        nothing happened on click.
      */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="md"
        fullWidth
        container={container}
        sx={{ zIndex: 1500 }}
      >
        <DialogTitle>{modalTitle}</DialogTitle>
        <DialogContent dividers>{fullNode}</DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

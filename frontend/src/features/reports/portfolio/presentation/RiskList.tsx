import { useState, useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  Box, Typography, Stack, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { projectAccent } from './ExpandableList';
import { useFullscreenContainer } from './FullscreenContainerContext';

export interface RiskItem {
  projectName: string;
  title: string;
  priority?: string;
  description?: string;
  status?: string;
}

interface RiskListProps {
  risks: RiskItem[];
  max?: number;
  bulletColor?: string;
  modalTitle?: string;
}

// Priority -> chip color, following the app's Green/Amber/Red health convention.
function priorityChipColor(priority?: string): { bg: string; fg: string } {
  switch ((priority || '').toUpperCase()) {
    case 'CRITICAL': return { bg: '#c62828', fg: '#fff' };
    case 'HIGH': return { bg: '#f44336', fg: '#fff' };
    case 'MEDIUM': return { bg: '#ff9800', fg: '#fff' };
    case 'LOW': return { bg: '#4caf50', fg: '#fff' };
    default: return { bg: '#9e9e9e', fg: '#fff' };
  }
}

function groupByProject(risks: RiskItem[]): Array<{ project: string; items: RiskItem[] }> {
  const order: string[] = [];
  const map = new Map<string, RiskItem[]>();
  for (const r of risks) {
    const key = r.projectName || 'Other';
    if (!map.has(key)) { order.push(key); map.set(key, []); }
    map.get(key)!.push(r);
  }
  return order.map(project => ({ project, items: map.get(project)! }));
}

// One risk row: title + priority chip, then a 2-line clamped description with an
// inline more/less toggle. The toggle only appears when the text actually
// overflows two lines (measured via scrollHeight vs clientHeight), so short
// descriptions stay clean. `alwaysExpanded` is used inside the modal where we
// show the full text with no toggle.
function RiskRow({ risk, alwaysExpanded = false }: { risk: RiskItem; alwaysExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chip = priorityChipColor(risk.priority);
  const showFull = alwaysExpanded || expanded;

  useLayoutEffect(() => {
    if (alwaysExpanded) return;
    const el = ref.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [risk.description, alwaysExpanded]);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.4 }}>
          {risk.title}
        </Typography>
        {risk.priority && (
          <Chip
            label={risk.priority}
            size="small"
            sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: chip.bg, color: chip.fg }}
          />
        )}
      </Box>
      {risk.description && (
        <>
          <Typography
            ref={ref}
            variant="body2"
            sx={{
              color: 'text.secondary',
              lineHeight: 1.45,
              mt: 0.25,
              ...(showFull
                ? {}
                : {
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }),
            }}
          >
            {risk.description}
          </Typography>
          {!alwaysExpanded && (overflowing || expanded) && (
            <Button
              size="small"
              variant="text"
              onClick={() => setExpanded(e => !e)}
              sx={{ p: 0, minWidth: 0, textTransform: 'none', fontWeight: 600, fontSize: 12, lineHeight: 1.4 }}
            >
              {expanded ? 'less' : 'more'}
            </Button>
          )}
        </>
      )}
    </Box>
  );
}

function renderGroups(risks: RiskItem[], bulletColor: string, alwaysExpanded = false): ReactNode {
  const groups = groupByProject(risks);
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
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: accent, lineHeight: 1.3, mb: 0.5 }}>
              {g.project}
            </Typography>
            <Stack spacing={0.75}>
              {g.items.map((risk, i) => (
                <RiskRow key={i} risk={risk} alwaysExpanded={alwaysExpanded} />
              ))}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

/**
 * Renders open risks grouped by project. Each risk shows its title + priority
 * chip and the first 2 lines of its description, with an inline more/less
 * toggle. Top-N risks render inline; if there are more, a "View all (N)" button
 * opens a dialog listing every risk with full descriptions.
 */
export function RiskList({ risks, max = 4, bulletColor = '#c62828', modalTitle = 'All Open Risks' }: RiskListProps) {
  const [open, setOpen] = useState(false);
  const container = useFullscreenContainer();

  if (!risks || risks.length === 0) return null;

  const inline = risks.slice(0, max);
  const overflow = Math.max(0, risks.length - max);

  return (
    <>
      {renderGroups(inline, bulletColor)}
      {overflow > 0 && (
        <Button
          size="small"
          variant="text"
          onClick={() => setOpen(true)}
          sx={{ mt: 1, alignSelf: 'flex-start', textTransform: 'none', fontWeight: 600 }}
        >
          View all ({risks.length})
        </Button>
      )}
      {/* z-index 1500 sits above PortfolioPresentation's full-screen container (1400). */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth container={container} sx={{ zIndex: 1500 }}>
        <DialogTitle>{modalTitle}</DialogTitle>
        <DialogContent dividers>{renderGroups(risks, bulletColor, true)}</DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

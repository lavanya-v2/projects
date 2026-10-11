import { Box, Skeleton, Typography } from '@mui/material';
import { useAutomationLabels } from './hooks';
import { COLORS } from './charts/chartCommon';
import { InfoHint, Kpi } from './ui';

interface Props {
  projectId: number;
}

const AMBER = '#ff9800';

const INFO = {
  automated: 'Tickets carrying the "automated" label — automated tests exist.',
  pending:
    'Tickets labelled "NeedAutomation" that have not reached "automated" yet — your automation backlog.',
  notRequired: 'Tickets labelled "automation-na" — they genuinely do not need automated tests.',
  unlabelled:
    'Tickets carrying none of the three automation labels. Until these are triaged, automation coverage for the project cannot be reported.',
};

/**
 * Live-Jira automation-label breakdown for the member's CURRENT OPEN SPRINT.
 * Deliberately a different window from the charts below (last 5 completed sprints) —
 * the point is to surface untriaged tickets while they can still be labelled.
 *
 * Loads lazily after the DB-driven charts, and renders nothing when Jira is
 * unavailable so it can never block them.
 */
export function AutomationCallout({ projectId }: Props) {
  const { data, isLoading } = useAutomationLabels(projectId, true);

  if (isLoading) {
    return (
      <Box sx={{ mb: 2 }}>
        <Skeleton variant="text" width={220} height={22} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(4,1fr)' },
            gap: 1.5,
            mt: 0.5,
          }}
        >
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} variant="rounded" height={72} />
          ))}
        </Box>
      </Box>
    );
  }

  // Jira unreachable / no token / no QA-assignee field / not applicable — stay silent.
  if (!data || data.unavailable) return null;
  // Nothing assigned in the open sprint: no card rather than a row of zeros.
  if (data.total === 0) return null;

  const hasGap = data.unlabelled > 0;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1 }}>
        Automation labels
        <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 500, ml: 0.75 }}>
          current open sprint - {data.total} ticket{data.total === 1 ? '' : 's'}
          {data.basis === 'qaAssignee' ? ' assigned to you as QA' : ' assigned to you'}
        </Typography>
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(4,1fr)' },
          gap: 1.5,
        }}
      >
        <Kpi value={String(data.automated)} label="Automated" color={COLORS.green} info={INFO.automated} />
        <Kpi value={String(data.pending)} label="Marked, not yet automated" info={INFO.pending} />
        <Kpi value={String(data.notRequired)} label="Not required" info={INFO.notRequired} />
        <Kpi
          value={String(data.unlabelled)}
          label="No automation label"
          color={hasGap ? AMBER : COLORS.green}
          info={INFO.unlabelled}
          highlight={hasGap}
        />
      </Box>

      {hasGap ? (
        <Box
          sx={{
            mt: 1.25,
            p: 1.25,
            borderRadius: 2,
            bgcolor: '#fff8e1',
            border: '1px solid #ffe0b2',
            fontSize: 13,
            color: '#7c4a03',
          }}
        >
          <Box component="span" sx={{ fontWeight: 700 }}>
            {data.unlabelled} ticket{data.unlabelled === 1 ? '' : 's'} need an automation label
          </Box>
          <InfoHint text={INFO.unlabelled} />
          <Box sx={{ mt: 0.5 }}>
            Add <strong>automated</strong>, <strong>NeedAutomation</strong> or{' '}
            <strong>automation-na</strong> to:
          </Box>
          <Box sx={{ mt: 0.5, fontWeight: 600 }}>
            {data.unlabelledKeys.map(k => k.key).join(', ')}
          </Box>
        </Box>
      ) : (
        <Typography sx={{ mt: 1, fontSize: 13, color: COLORS.green, fontWeight: 600 }}>
          Every current-sprint ticket of yours is triaged for automation.
        </Typography>
      )}
    </Box>
  );
}

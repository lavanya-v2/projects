import { Box, Chip, Paper, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import { useClaudeUsageAccess, useMyPromptReport } from '../claude-usage/hooks';
import { ClaudeUsageComingSoon } from '../claude-usage/ClaudeUsageComingSoon';
import { TIER_META, toISODate, daysAgo } from '../claude-usage/ui';
import { useActiveAccountProjects } from '../../shared/hooks/useActiveAccountProjects';
import { PATHS } from '../../routes/paths';

/**
 * ADDENDUM 23 item 4 — a small self-usage indicator on the member/lead dashboard
 * (both roles land on MemberDashboard by default). Click-through to the full report;
 * shows ClaudeUsageComingSoon (compact) when the viewer isn't pilot-enrolled yet.
 *
 * ADDENDUM 25: gated OUTSIDE that by whether the active account has any project
 * on Claude at all — a project not using Claude renders nothing here, not even
 * the compact "coming soon" card, since that message would be irrelevant noise.
 */
export function ClaudeUsageIndicator() {
  const navigate = useNavigate();
  const { hasClaudeProjects, loading: projectsLoading } = useActiveAccountProjects();
  const { data: access, isLoading: accessLoading } = useClaudeUsageAccess();
  const enabled = access?.enabled ?? false;

  // Hooks must run unconditionally on every render (Rules of Hooks) — the
  // early "nothing to show" returns happen below, after all hooks are called.
  // Short window — this is a glance/teaser, not the full report.
  const { data: report, isLoading: reportLoading } = useMyPromptReport(
    toISODate(daysAgo(7)),
    toISODate(new Date()),
    enabled && hasClaudeProjects,
  );

  if (projectsLoading) return null;
  if (!hasClaudeProjects) return null;
  if (accessLoading || (enabled && reportLoading)) return null;

  if (!enabled) {
    return <ClaudeUsageComingSoon compact />;
  }

  if (!report?.hasData) {
    // Enrolled, but nothing pushed yet — a short nudge rather than a stat card with zeros.
    return (
      <Paper
        elevation={0}
        onClick={() => navigate(PATHS.MY_CLAUDE_REPORT)}
        sx={{
          p: 2.5, borderRadius: 3.5, border: '1px solid #e2e8f0', cursor: 'pointer',
          '&:hover': { borderColor: '#c7d2e0' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeIcon sx={{ fontSize: 20, color: '#4f46e5' }} />
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Claude usage</Typography>
          <Box sx={{ flexGrow: 1 }} />
          <ChevronRightIcon sx={{ color: '#94a3b8' }} />
        </Box>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
          Set up the collector to start seeing your prompt-coaching report.
        </Typography>
      </Paper>
    );
  }

  const tier = report.skillTier;
  return (
    <Paper
      elevation={0}
      onClick={() => navigate(PATHS.MY_CLAUDE_REPORT)}
      sx={{
        p: 2.5, borderRadius: 3.5, border: '1px solid #e2e8f0', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
        '&:hover': { borderColor: '#c7d2e0' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesomeIcon sx={{ fontSize: 20, color: '#4f46e5' }} />
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Claude usage</Typography>
      </Box>
      <Chip
        label={`${tier.label} · ${tier.score}/100`}
        size="small"
        sx={{ bgcolor: `${TIER_META[tier.tier].color}22`, color: TIER_META[tier.tier].color, fontWeight: 700 }}
      />
      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
        Avg score {report.totals.avgScore}/100 · {report.totals.prompts} prompts (last 7 days)
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      <ChevronRightIcon sx={{ color: '#94a3b8' }} />
    </Paper>
  );
}

export default ClaudeUsageIndicator;

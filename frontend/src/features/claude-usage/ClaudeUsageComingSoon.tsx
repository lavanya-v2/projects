import { Box, Paper, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { PALETTE } from './ui';

/**
 * ADDENDUM 23 — one shared "not available yet" screen for the Claude Usage feature,
 * used wherever a viewer hits the pilot-enrollment gate: the `/claude-usage/me` route
 * guard (replacing a silent redirect-to-dashboard) and the member/lead dashboard's
 * compact usage indicator (in its `compact` form). Deliberately not shown for the
 * `/claude-usage/team` route — team view no longer depends on the viewer's own
 * enrollment (see backend/src/modules/member/routes/index.ts).
 */
export function ClaudeUsageComingSoon({ compact = false }: { compact?: boolean }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: compact ? 2.5 : 4,
        border: `1px dashed ${PALETTE.border}`,
        borderRadius: compact ? 3 : 2,
        textAlign: 'center',
        bgcolor: '#fafbfc',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
        <AutoAwesomeIcon sx={{ fontSize: compact ? 22 : 28, color: PALETTE.ink2 }} />
      </Box>
      <Typography sx={{ fontSize: compact ? 14 : 16, fontWeight: 600, color: PALETTE.navy, mb: 0.5 }}>
        Claude Usage — coming soon
      </Typography>
      <Typography sx={{ fontSize: compact ? 12 : 13.5, color: PALETTE.ink2, maxWidth: 420, mx: 'auto', lineHeight: 1.6 }}>
        This isn't enabled for you yet. Ask your admin to add you to the Claude Usage pilot
        to start seeing your prompt-coaching report.
      </Typography>
    </Paper>
  );
}

export default ClaudeUsageComingSoon;

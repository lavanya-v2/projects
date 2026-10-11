import { Alert, Avatar, Box, CircularProgress, Paper, Typography } from '@mui/material';
import { useMemberDashboard } from './hooks';
import { ProjectSection } from './ProjectSection';
import { ClaudeUsageIndicator } from './ClaudeUsageIndicator';
import { PendingReviewCard } from './PendingReviewCard';
import { usePermissions } from '../../shared/hooks/usePermissions';

function initials(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/);
  if (!parts[0]) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function MemberDashboard() {
  const { data, isLoading, isError } = useMemberDashboard();
  const { isSuperuser } = usePermissions();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError) {
    return (
      <Box sx={{ maxWidth: 1180, mx: 'auto', py: 2 }}>
        <Alert severity="error">Failed to load your dashboard. Please refresh.</Alert>
      </Box>
    );
  }

  const firstName = (data?.memberName ?? '').trim().split(/\s+/)[0] || 'there';

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto', px: { xs: 1, md: 0 }, py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, mb: 0.5 }}>
        <Avatar sx={{ width: 46, height: 46, fontWeight: 700, bgcolor: '#4f46e5' }}>
          {initials(data?.memberName)}
        </Avatar>
        <Typography sx={{ fontSize: 24, fontWeight: 700 }}>Welcome back, {firstName}</Typography>
      </Box>
      <Typography sx={{ color: 'text.secondary', fontSize: 14, ml: '60px', mb: 3 }}>
        Your performance across the projects you work on - last 5 completed sprints (current sprint excluded)
      </Typography>

      {/* Hidden from everyone but superusers for now (pre-launch). */}
      {isSuperuser && <PendingReviewCard />}

      <Box sx={{ mb: 3.25 }}>
        <ClaudeUsageIndicator />
      </Box>

      {!data?.linked ? (
        <Paper sx={{ p: 4, borderRadius: 3, textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 0.5 }}>
            Your account isn't linked to a team member yet
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>
            We couldn't match your login to a team member record. Please contact your administrator.
          </Typography>
        </Paper>
      ) : data.projects.length === 0 ? (
        <Paper sx={{ p: 4, borderRadius: 3, textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>
            You're not assigned to any projects yet.
          </Typography>
        </Paper>
      ) : (
        data.projects.map(p => <ProjectSection key={p.projectId} project={p} />)
      )}
    </Box>
  );
}

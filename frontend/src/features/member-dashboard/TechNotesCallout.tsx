import { Alert, AlertTitle, Box } from '@mui/material';
import { useTechNotesGap } from './hooks';

interface Props {
  projectId: number;
}

/**
 * Live-Jira nudge: tickets in the member's current open sprint missing
 * Technical Notes. Renders nothing while loading or if Jira is unavailable,
 * so it never blocks the DB-driven charts.
 */
export function TechNotesCallout({ projectId }: Props) {
  const { data, isLoading } = useTechNotesGap(projectId, true);

  if (isLoading || !data || data.unavailable) return null;

  if (data.count === 0) {
    return (
      <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
        You're all caught up — every current-sprint ticket assigned to you has Technical Notes.
      </Alert>
    );
  }

  return (
    <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
      <AlertTitle sx={{ fontWeight: 700, mb: 0.25 }}>
        {data.count} ticket{data.count === 1 ? '' : 's'} missing Technical Notes
      </AlertTitle>
      In the current sprint, assigned to you — please add tech notes.
      {data.keys.length > 0 && (
        <Box sx={{ mt: 0.75, fontWeight: 600 }}>
          {data.keys.map(k => k.key).join(', ')}
        </Box>
      )}
    </Alert>
  );
}

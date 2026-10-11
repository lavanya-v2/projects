import { Box } from '@mui/material';

/**
 * The one explanation of what a cycle status means — shown inline via tooltip
 * in ReviewCyclesListPage.tsx and CycleAdminPage.tsx, and matching the wording
 * in docs/performance-review-user-guide.html and
 * docs/performance-review-how-it-works.html. Edit here, not in three places.
 */
export const STATUS_LEGEND = (
  <Box sx={{ fontSize: 12 }}>
    <div><strong>scheduled</strong> — dates exist, nothing attached yet, nothing to review.</div>
    <div><strong>open</strong> — data attached, participants frozen, leads can draft/submit reviews.</div>
    <div><strong>locked</strong> — final recompute done, inputs frozen; not yet visible to members.</div>
    <div><strong>published</strong> — the one-way step; scores and reviews become visible to members.</div>
    <div><strong>archived</strong> — cancelled before opening, or manually archived after — a permanent record.</div>
  </Box>
);

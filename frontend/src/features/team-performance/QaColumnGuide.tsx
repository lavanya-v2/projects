import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Typography,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  InfoOutlined as InfoOutlinedIcon,
} from '@mui/icons-material';

// Per-column explanations for the QA Performance table, rendered in the same
// "What do these mean?" accordion style as the Sprint Summary section.
const QA_COLUMN_HELP: Array<[string, string]> = [
  ['New Bugs', 'Bugs and sub-bugs first logged during this sprint (Jira created date inside the sprint window), attributed to the reporter. Carryover bugs from earlier sprints are excluded.'],
  ['Weighted', 'Severity-weighted bug volume: Critical ×3 + High ×2 + Medium ×1.5 + Low ×1. A quick sense of bug load beyond a raw count.'],
  ['Quality', 'Composite QA rating = (1 − [0.70 × UAT pass rate + 0.30 × in-sprint catch]) × 100. Lower is better. UAT pass rate (SP-weighted) = 1 − (SP of cleared tickets rejected in UAT / SP of all cleared tickets). In-sprint catch = bugs against a current-sprint story / bugs raised. Bands: Excellent ≤10 · Good ≤25 · Fair ≤40 · Low >40. N/A when fewer than 5 tickets tested.'],
  ['Tested', 'Count of tickets this member signed off through QA (they were the last mover from a QA status to Done / UAT).'],
  ['QA Cycle', 'Average hours a ticket spent in the QA lane before sign-off, over the tickets this member tested.'],
  ['Escape %', 'Confirmed production bugs / tickets tested × 100. Lower is better. Shown for awareness — it is NOT part of the Quality rating.'],
];


export function QaColumnGuide() {
  return (
    <Accordion
      defaultExpanded={false}
      elevation={0}
      disableGutters
      sx={{ bgcolor: 'transparent', '&:before': { display: 'none' }, borderTop: '1px solid #e2e8f0' }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon fontSize="small" />}
        sx={{ px: 2.5, py: 0, minHeight: 0,
              '& .MuiAccordionSummary-content': { my: 0.75, alignItems: 'center', gap: 0.5 } }}
      >
        <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="caption" color="text.secondary">What do these mean?</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 2.5, pt: 0.5, pb: 1.5 }}>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 1.5, rowGap: 0.5 }}>
          {QA_COLUMN_HELP.map(([col, desc]) => (
            <Box key={col} sx={{ display: 'contents' }}>
              <Typography component="dt" variant="caption" fontWeight={700}>{col}</Typography>
              <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>{desc}</Typography>
            </Box>
          ))}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
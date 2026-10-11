import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

interface Props {
    open: boolean;
    onClose: () => void;
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 3, mb: 1, color: '#1e3a8a' }}>
        {children}
    </Typography>
);

const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <Typography variant="body2" sx={{ mb: 0.75, lineHeight: 1.6 }}>
        <Typography component="span" variant="body2" fontWeight={700}>{label}: </Typography>
        {children}
    </Typography>
);

const Code = ({ children }: { children: React.ReactNode }) => (
    <Box component="code" sx={{ bgcolor: '#f3f4f6', px: 0.5, py: 0.1, borderRadius: 0.5, fontFamily: 'monospace', fontSize: 12 }}>
        {children}
    </Box>
);

export function MethodologyDoc({ open, onClose }: Props) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h6" fontWeight={700}>How we compute Sprint Summary numbers</Typography>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Each Sprint Summary tile is derived from Jira's <Code>Sprint</Code>-field and <Code>Story Points</Code>-field
                    changelogs, cross-checked against Jira's authoritative sprint-report API. When our number and Jira's diverge by more than 10%,
                    a warning badge appears on the tile. Below is the exact rule per tile, plus the known limitations.
                </Typography>

                <SectionTitle>Committed at Start</SectionTitle>
                <Line label="Formula">Sum of SP for every ticket that was in this Jira sprint at the moment "Start Sprint" was clicked, using each ticket's SP at that moment.</Line>
                <Line label="Reconstructed from">Each ticket's <Code>Sprint</Code>-field and <Code>Story Points</Code>-field changelogs (both current-in-sprint and punted tickets).</Line>
                <Line label="Excludes">Tickets that were on the sprint board at start but had no assignee AND were later removed (treated as placeholders/grooming items). Example: LOT-2884 (3 SP, unassigned, status=Backlog, moved out day 6).</Line>
                <Line label="Cross-checked against">Jira's <Code>completedIssuesInitialEstimateSum + issuesNotCompletedInitialEstimateSum</Code>. Divergence &gt; 10% surfaces a warning banner.</Line>
                <Line label="Known limitation">When a manager re-estimates SP mid-sprint AFTER sprint start, our reconstruction captures the SP value at the start, not the post-edit value.</Line>

                <SectionTitle>Final Scope</SectionTitle>
                <Line label="Formula">Total Completed + Carry Over (i.e., everything in the sprint when it closed, excluding punted tickets).</Line>
                <Line label="Why this matters">"Total Planned" used to mean this, but the label was confusing. "Final Scope" makes clear that it's the end-state, not the initial commitment.</Line>
                <Line label="Net Scope Change">= Final Scope − Committed at Start. This is the headline SM reports.</Line>

                <SectionTitle>Total Completed</SectionTitle>
                <Line label="Formula">Sum of SP across ALL tickets with <Code>was_completed = true</Code>, regardless of assignee. Captures unassigned work that the per-developer breakdown misses.</Line>
                <Line label="Status criteria">Either Jira's <Code>statusCategory = 'done'</Code> at sprint close, OR a <Code>resolutiondate</Code> within the sprint window (handles "Closed" status that some Jira boards don't put in the Done column).</Line>
                <Line label="Cross-checked against">Jira's <Code>completedIssuesEstimateSum + issuesCompletedInAnotherSprintEstimateSum</Code>.</Line>

                <SectionTitle>Carry Over</SectionTitle>
                <Line label="Formula">Sum of SP for tickets in the sprint at close that did NOT finish AND were NOT punted, with an assignee.</Line>
                <Line label="Excludes">Sub-bugs (0-SP defects on parent stories) — those are counted under QA quality metrics, not developer carryover.</Line>

                <SectionTitle>Scope Change (Net)</SectionTitle>
                <Line label="Formula">Final Scope − Committed at Start.</Line>
                <Line label="Caption shows">Gross adds and removes that produced the net (e.g. "6 added · 13 removed"). The net can be positive or negative.</Line>

                <SectionTitle>Scope Adds (Team)</SectionTitle>
                <Line label="Formula">Tickets added mid-sprint to V2-team developers, excluding carry-in from the immediately-preceding sprint. Gross count — does not net out removals.</Line>
                <Line label="V2 filter">"Team" means the assignee is on the V2 roster (<Code>team_members.v2_member = true</Code>). Non-V2 adds appear in the "across all teams" caption.</Line>

                <SectionTitle>Removed (Team)</SectionTitle>
                <Line label="Formula">Tickets explicitly pulled out of the sprint mid-stream (sprint-id removed from the issue's Sprint field).</Line>
                <Line label="Distinguished from Carry Over">Punted = removed from sprint; Carry Over = stayed in sprint but didn't finish.</Line>

                <SectionTitle>When numbers may not match the Scrum Master's report</SectionTitle>
                <Box component="ul" sx={{ pl: 3, my: 0.5 }}>
                    <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        <b>SM rounding:</b> fractional SP (e.g. 0.5 → 1) — we show exact fractions.
                    </Typography>
                    <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        <b>Manual exclusions:</b> SM may exclude tickets we count algorithmically (or vice versa). The "unassigned tickets" warning banner surfaces the most common case.
                    </Typography>
                    <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        <b>Mid-sprint re-estimation:</b> we use end-of-sprint SP for the most part; SM's tally may anchor to planning-time SP.
                    </Typography>
                    <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        <b>"Closed" vs "Done":</b> some Jira boards have a Done column that excludes "Closed". Our resolutiondate fallback rule (see Total Completed) catches these.
                    </Typography>
                </Box>

                <SectionTitle>How to diagnose a specific mismatch</SectionTitle>
                <Box component="ol" sx={{ pl: 3, my: 0.5 }}>
                    <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        Run <Code>backend/scripts/debug-committed-per-ticket.js</Code> for the sync — shows per-ticket commitment classification.
                    </Typography>
                    <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        Inspect the <Code>quality_report</Code> JSON on <Code>perf_sprint_syncs</Code> — lists Jira's view alongside ours.
                    </Typography>
                    <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        Compare the Carry-Over Tickets accordion to SM's email — the exact ticket list, not just totals.
                    </Typography>
                    <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                        For sprint-wide audit: <Code>SELECT id, sprint_name, quality_report-{'>'}'divergenceFlags' FROM perf_sprint_syncs WHERE jsonb_array_length(quality_report-{'>'}'divergenceFlags') {'>'} 0;</Code>
                    </Typography>
                </Box>
            </DialogContent>
        </Dialog>
    );
}

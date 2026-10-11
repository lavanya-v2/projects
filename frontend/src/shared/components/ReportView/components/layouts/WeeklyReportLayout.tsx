import { Box, Paper, Typography, Divider } from '@mui/material';
import { SectionHeader } from '../primitives/SectionHeader';
import { RiskBullets } from '../primitives/RiskBullets';
import { ProjectInsightsPanel } from '../ProjectInsightsPanel';
import { WorkSummarySection } from '../WorkSummarySection';
import { ContributorsFooter } from '../ContributorsFooter';
import type { WeeklyReportDataLike } from '../../types';
import type { InsightsEditorController } from '../../hooks/useInsightsEditor';
import type { TeamNotesController } from '../../hooks/useTeamNotes';

interface WeeklyReportLayoutProps {
    data: WeeklyReportDataLike;
    isLead: boolean;
    insights: InsightsEditorController;
    notes: TeamNotesController;
}

export const WeeklyReportLayout = ({
    data,
    isLead,
    insights,
    notes,
}: WeeklyReportLayoutProps) => (
    <>
        {/* Hero Paper: summary top, risks + achievements side-by-side below */}
        <Paper elevation={2} sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <Box sx={{ px: { xs: 2.5, md: 3.5 }, pt: 3, pb: 2.5 }}>
                <SectionHeader color="#1976d2" title="Executive Summary" />
                <Typography
                    variant="body2"
                    sx={{ whiteSpace: 'pre-line', lineHeight: 1.9, color: 'text.primary' }}
                >
                    {insights.localExecutiveSummary || 'No executive summary available.'}
                </Typography>
            </Box>

            <Divider />

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                        xs: '1fr',
                        md: data.achievements ? '1fr 1fr' : '1fr',
                    },
                }}
            >
                <Box
                    sx={{
                        px: { xs: 2.5, md: 3 },
                        py: 2.5,
                        borderRight: data.achievements ? { md: '1px solid #f0f0f0' } : undefined,
                        borderBottom: {
                            xs: data.achievements ? '1px solid #f0f0f0' : 'none',
                            md: 'none',
                        },
                    }}
                >
                    <SectionHeader color="#c62828" title="Risks & Blockers" />
                    {data.risks ? (
                        <RiskBullets text={data.risks} color="#c62828" />
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            None identified.
                        </Typography>
                    )}
                </Box>

                {data.achievements && (
                    <Box sx={{ px: { xs: 2.5, md: 3 }, py: 2.5 }}>
                        <SectionHeader color="#2e7d32" title="Achievements" />
                        <Typography
                            variant="body2"
                            sx={{ whiteSpace: 'pre-line', lineHeight: 1.8 }}
                        >
                            {data.achievements}
                        </Typography>
                    </Box>
                )}
            </Box>
        </Paper>

        <ProjectInsightsPanel
            type="weekly"
            isLead={isLead}
            insights={insights}
            notes={notes}
        />

        <WorkSummarySection workSummary={data.workSummary} />

        <ContributorsFooter
            teamMembers={data.teamMembers}
            reportWindow={data.reportWindow}
        />
    </>
);

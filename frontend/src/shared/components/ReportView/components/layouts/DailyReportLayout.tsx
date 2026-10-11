import { Box, Paper, Typography } from '@mui/material';
import { SectionHeader } from '../primitives/SectionHeader';
import { RiskBullets } from '../primitives/RiskBullets';
import { SprintProgressStrip } from '../SprintProgressStrip';
import { ProjectInsightsPanel } from '../ProjectInsightsPanel';
import { WorkSummarySection } from '../WorkSummarySection';
import { TicketDetailsSection } from '../TicketDetailsSection';
import { ContributorsFooter } from '../ContributorsFooter';
import type { DailyAnalysis, DailyReportDataLike } from '../../types';
import type { InsightsEditorController } from '../../hooks/useInsightsEditor';
import type { TeamNotesController } from '../../hooks/useTeamNotes';

interface DailyReportLayoutProps {
    data: DailyReportDataLike;
    isLead: boolean;
    insights: InsightsEditorController;
    notes: TeamNotesController;
}

export const DailyReportLayout = ({
    data,
    isLead,
    insights,
    notes,
}: DailyReportLayoutProps) => {
    const analysis: DailyAnalysis = data.analysis;
    // Only a real burndown drives the strip; a bypassed marker carries no metrics.
    const sprintBurndown = data.sprintBurndown && !data.sprintBurndown.bypassed
        ? data.sprintBurndown
        : null;

    return (
        <>
            {/* Hero Paper: 2-col + sprint strip */}
            <Paper elevation={2} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' } }}>
                    {/* Left: Executive Summary */}
                    <Box
                        sx={{
                            p: { xs: 2.5, md: 3.5 },
                            borderRight: { md: '1px solid #f0f0f0' },
                            borderBottom: { xs: '1px solid #f0f0f0', md: 'none' },
                        }}
                    >
                        <SectionHeader color="#1976d2" title="Executive Summary" />
                        <Typography
                            variant="body2"
                            sx={{ whiteSpace: 'pre-line', lineHeight: 1.9, color: 'text.primary' }}
                        >
                            {insights.localExecutiveSummary || 'No executive summary available.'}
                        </Typography>
                    </Box>

                    {/* Right: Risks & Blockers */}
                    <Box sx={{ bgcolor: '#f9f9fb', display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{ p: { xs: 2.5, md: 2.5 }, flex: 1 }}>
                            <SectionHeader color="#c62828" title="Risks & Blockers" />
                            {analysis.risks ? (
                                <RiskBullets text={analysis.risks} color="#c62828" />
                            ) : (
                                <Typography variant="body2" color="text.secondary">
                                    None identified.
                                </Typography>
                            )}
                            {analysis.dataQualityFlags?.newlyBlockedInBacklog && analysis.dataQualityFlags.newlyBlockedInBacklog.length > 0 && (
                                <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px dashed #e0e0e0' }}>
                                    <Typography variant="caption" sx={{ color: '#546e7a', fontStyle: 'italic' }}>
                                        FYI (not impacting health): {analysis.dataQualityFlags.newlyBlockedInBacklog.length} backlog ticket{analysis.dataQualityFlags.newlyBlockedInBacklog.length !== 1 ? 's' : ''} marked blocked today — {analysis.dataQualityFlags.newlyBlockedInBacklog.map(t => t.key).join(', ')}
                                    </Typography>
                                </Box>
                            )}
                            {analysis.dataQualityFlags?.newlyAddedProdBugs && analysis.dataQualityFlags.newlyAddedProdBugs.length > 0 && (
                                <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px dashed #e0e0e0' }}>
                                    <Typography variant="caption" sx={{ color: '#546e7a', fontStyle: 'italic' }}>
                                        FYI (not impacting health): {analysis.dataQualityFlags.newlyAddedProdBugs.length} prod bug{analysis.dataQualityFlags.newlyAddedProdBugs.length !== 1 ? 's' : ''} added to sprint today — {analysis.dataQualityFlags.newlyAddedProdBugs.map(t => t.key).join(', ')}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Box>
                </Box>

                {/*
                  * A bypassed burndown is a marker, not data: it says the sprint being reported
                  * on did not exist yet. Rendering the strip for it drew an empty bar that read
                  * as "no progress was made", which is a different and wrong statement.
                  */}
                {sprintBurndown && (
                    <SprintProgressStrip
                        sb={sprintBurndown}
                        subBugsLoggedCount={data.subBugsLoggedCount}
                        reopenedTicketsCount={data.reopenedTicketsCount}
                        estimationType={data.estimationType}
                    />
                )}
                {data.sprintBurndown?.bypassed && (
                    <Box
                        sx={{
                            borderTop: '1px solid #f0f0f0',
                            px: { xs: 2.5, md: 3.5 },
                            py: 1.5,
                        }}
                    >
                        <Typography variant="caption" color="text.secondary">
                            Sprint progress is not shown for this date.
                            {data.sprintBurndown.activeSprintName
                                ? ` The board's current sprint (${data.sprintBurndown.activeSprintName}) started after this day, so it did not exist yet.`
                                : ' The board\'s current sprint started after this day.'}
                            {' '}The ticket activity below is unaffected.
                        </Typography>
                    </Box>
                )}
                {!sprintBurndown
                    && (data.subBugsLoggedCount != null || data.reopenedTicketsCount != null) && (
                    <Box
                        sx={{
                            borderTop: '1px solid #f0f0f0',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            px: { xs: 2.5, md: 3.5 },
                            py: 1.5,
                            flexWrap: 'wrap',
                        }}
                    >
                        {data.subBugsLoggedCount != null && (
                            <Typography variant="caption" color="text.secondary">
                                {data.subBugsLoggedCount} sub-bug{data.subBugsLoggedCount === 1 ? '' : 's'} logged
                            </Typography>
                        )}
                        {data.subBugsLoggedCount != null && data.reopenedTicketsCount != null && (
                            <Typography variant="caption" color="text.disabled">·</Typography>
                        )}
                        {data.reopenedTicketsCount != null && (
                            <Typography variant="caption" color="text.secondary">
                                {data.reopenedTicketsCount} tkt{data.reopenedTicketsCount === 1 ? '' : 's'} in reopened lane
                            </Typography>
                        )}
                    </Box>
                )}
            </Paper>

            <ProjectInsightsPanel
                type="daily"
                isLead={isLead}
                insights={insights}
                notes={notes}
            />

            <WorkSummarySection workSummary={analysis.workSummary} />

            {analysis.ticketDetails && (
                <TicketDetailsSection
                    ticketDetails={analysis.ticketDetails}
                    ticketKeys={analysis.ticketKeys}
                    ticketDetailsStructured={analysis.ticketDetailsStructured}
                />
            )}

            <ContributorsFooter
                teamMembers={analysis.teamMembers}
                reportWindow={analysis.reportWindow}
            />
        </>
    );
};

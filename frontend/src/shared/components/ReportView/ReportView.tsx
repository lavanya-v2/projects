import { Box } from '@mui/material';
import { useReportDownload } from './hooks/useReportDownload';
import { useHealthSuggestion } from './hooks/useHealthSuggestion';
import { useInsightsEditor } from './hooks/useInsightsEditor';
import { useTeamNotes } from './hooks/useTeamNotes';
import { ReportHeader } from './components/ReportHeader';
import { HealthAlerts } from './components/HealthAlerts';
import { DailyReportLayout } from './components/layouts/DailyReportLayout';
import { WeeklyReportLayout } from './components/layouts/WeeklyReportLayout';
import { SummaryPreviewDialog } from './components/SummaryPreviewDialog';
import type {
    ReportViewProps,
    DailyAnalysis,
    DailyReportDataLike,
    WeeklyReportDataLike,
} from './types';

/**
 * Top-level report view used by both the Daily and Weekly report pages.
 *
 * This component is intentionally thin: it composes purpose-built hooks (download, insights
 * editor, health suggestion, team notes) with a layout component chosen by `type`. All
 * behavioral/state logic lives in the hooks; all presentation lives in the section
 * components and layouts under `./components/`.
 */
export const ReportView = (props: ReportViewProps) => {
    const { data, type, projectName, isLead = false } = props;

    const download = useReportDownload(props);
    const health = useHealthSuggestion(props);
    const insights = useInsightsEditor(props, health);
    const notes = useTeamNotes(props);

    const analysis =
        type === 'daily'
            ? (data as DailyReportDataLike).analysis
            : (data as WeeklyReportDataLike);
    const computedHealth =
        type === 'daily'
            ? (analysis as DailyAnalysis).health
            : (data as WeeklyReportDataLike).status;
    const title =
        type === 'daily'
            ? `Daily Report: ${(data as DailyReportDataLike).boardName ?? projectName}`
            : `Weekly Report: ${projectName}`;

    return (
        <Box sx={{ mt: 2 }}>
            <ReportHeader
                title={title}
                computedHealth={computedHealth}
                insightsHealthOverride={health.localInsightsHealth}
                healthRationale={analysis.healthRationale}
                teamMemberAttribution={analysis.teamMemberAttribution}
                download={download}
            />

            <HealthAlerts type={type} isLead={isLead} health={health} />

            {type === 'daily' ? (
                <DailyReportLayout
                    data={data as DailyReportDataLike}
                    isLead={isLead}
                    insights={insights}
                    notes={notes}
                />
            ) : (
                <WeeklyReportLayout
                    data={data as WeeklyReportDataLike}
                    isLead={isLead}
                    insights={insights}
                    notes={notes}
                />
            )}

            <SummaryPreviewDialog insights={insights} />
        </Box>
    );
};

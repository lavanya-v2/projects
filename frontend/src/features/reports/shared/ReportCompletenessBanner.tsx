import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

interface ReportCompletenessBannerProps {
    /** Names of projects that could not be included in this rolled-up report. */
    projectsMissing?: string[] | null;
    sx?: object;
}

/**
 * Warns the reader when a rolled-up report (account/program) was generated without some of its
 * projects — e.g. a project failed to generate its own report for the period. Without this,
 * missing projects are dropped silently and figures/health understate true coverage.
 */
export default function ReportCompletenessBanner({ projectsMissing, sx }: ReportCompletenessBannerProps) {
    if (!projectsMissing || projectsMissing.length === 0) return null;

    const count = projectsMissing.length;
    return (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2, ...sx }}>
            <AlertTitle sx={{ fontWeight: 700 }}>
                {count} project{count > 1 ? 's' : ''} not included in this report
            </AlertTitle>
            {projectsMissing.join(', ')}. Figures and health below reflect only the included projects.
        </Alert>
    );
}

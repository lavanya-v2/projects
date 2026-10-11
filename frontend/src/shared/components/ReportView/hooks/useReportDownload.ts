import { useState, useCallback } from 'react';
import {
    useDownloadDailyReportText,
    useDownloadDailyReportCSV,
} from '../../../../features/reports/daily/hooks';
import {
    useDownloadWeeklyReportText,
    useDownloadWeeklyReportCSV,
} from '../../../../features/reports/weekly/hooks';
import type { ReportViewProps } from '../types';

export type DownloadFormat = 'text' | 'csv';

export interface ReportDownloadController {
    anchorEl: HTMLElement | null;
    open: boolean;
    handleOpen: (event: React.MouseEvent<HTMLButtonElement>) => void;
    handleClose: () => void;
    handleDownload: (format: DownloadFormat) => Promise<void>;
}

/**
 * Owns the state + dispatch for the Download menu on the report header.
 * Dispatches to the correct daily/weekly mutation based on `props.type`.
 */
export const useReportDownload = (props: ReportViewProps): ReportDownloadController => {
    const { type, projectCode, date, startDate, endDate } = props;

    const dailyText = useDownloadDailyReportText();
    const dailyCsv = useDownloadDailyReportCSV();
    const weeklyText = useDownloadWeeklyReportText();
    const weeklyCsv = useDownloadWeeklyReportCSV();

    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

    const handleOpen = useCallback(
        (event: React.MouseEvent<HTMLButtonElement>) => setAnchorEl(event.currentTarget),
        [],
    );
    const handleClose = useCallback(() => setAnchorEl(null), []);

    const handleDownload = useCallback(
        async (format: DownloadFormat) => {
            try {
                if (type === 'daily') {
                    if (!date) return;
                    if (format === 'text') {
                        await dailyText.mutateAsync({ projectName: projectCode, date });
                    } else {
                        await dailyCsv.mutateAsync({ projectName: projectCode, date });
                    }
                } else {
                    if (!startDate || !endDate) return;
                    if (format === 'text') {
                        await weeklyText.mutateAsync({ projectName: projectCode, startDate, endDate });
                    } else {
                        await weeklyCsv.mutateAsync({ projectName: projectCode, startDate, endDate });
                    }
                }
            } catch (err) {
                console.error(`Failed to download ${format.toUpperCase()}`, err);
            } finally {
                setAnchorEl(null);
            }
        },
        [type, date, startDate, endDate, projectCode, dailyText, dailyCsv, weeklyText, weeklyCsv],
    );

    return {
        anchorEl,
        open: Boolean(anchorEl),
        handleOpen,
        handleClose,
        handleDownload,
    };
};

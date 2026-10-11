import { useState, useCallback } from 'react';
import { useAddTeamNote } from '../../../../features/reports/daily/hooks';
import { useAuth } from '../../../../context/AuthContext';
import type {
    ReportViewProps,
    TeamNote,
    DailyAnalysis,
    WeeklyAnalysis,
    InsightsReportType,
} from '../types';

export interface TeamNotesController {
    resolvedReportId: number | undefined;
    teamNotes: TeamNote[];
    teamNoteText: string;
    setTeamNoteText: (text: string) => void;
    postingNote: boolean;
    handlePostTeamNote: () => Promise<void>;
}

export const useTeamNotes = (props: ReportViewProps): TeamNotesController => {
    const { data, type, reportId } = props;
    const { user } = useAuth();

    const analysis =
        type === 'daily'
            ? (data as { analysis: DailyAnalysis }).analysis
            : (data as WeeklyAnalysis);

    const resolvedReportId =
        reportId ?? (type === 'weekly' ? (data as { id?: number }).id : undefined);
    const reportTypeForApi: InsightsReportType =
        type === 'daily' ? 'daily' : 'weekly_project';

    const initialTeamNotes: TeamNote[] =
        (data as { teamNotes?: TeamNote[] }).teamNotes ?? analysis.teamNotes ?? [];

    const [teamNotes, setTeamNotes] = useState<TeamNote[]>(initialTeamNotes);
    const [teamNoteText, setTeamNoteText] = useState<string>('');
    const [postingNote, setPostingNote] = useState<boolean>(false);

    const addTeamNoteMutation = useAddTeamNote();

    const handlePostTeamNote = useCallback(async () => {
        if (!resolvedReportId || !teamNoteText.trim()) return;
        setPostingNote(true);
        try {
            await addTeamNoteMutation.mutateAsync({
                reportType: reportTypeForApi,
                id: resolvedReportId,
                text: teamNoteText.trim(),
            });
            setTeamNotes(prev => [
                ...prev,
                {
                    userId: user?.id ?? 0,
                    name: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(),
                    text: teamNoteText.trim(),
                    timestamp: new Date().toISOString(),
                },
            ]);
            setTeamNoteText('');
        } catch {
            // non-fatal
        } finally {
            setPostingNote(false);
        }
    }, [resolvedReportId, teamNoteText, reportTypeForApi, addTeamNoteMutation, user]);

    return {
        resolvedReportId,
        teamNotes,
        teamNoteText,
        setTeamNoteText,
        postingNote,
        handlePostTeamNote,
    };
};

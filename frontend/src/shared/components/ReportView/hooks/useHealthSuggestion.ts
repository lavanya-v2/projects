import { useState, useCallback } from 'react';
import { useApplyInsightsHealth } from '../../../../features/reports/daily/hooks';
import type { HealthSuggestion, ReportViewProps, DailyAnalysis, WeeklyAnalysis } from '../types';

interface SaveDailyInsightsResponse {
    healthSuggestion?: HealthSuggestion;
    healthCleared?: boolean;
    clearedFrom?: string;
}

export interface HealthSuggestionController {
    localInsightsHealth: string;
    healthSuggestion: HealthSuggestion | null;
    isApplyingHealth: boolean;
    healthCheckedNoEscalation: boolean;
    healthClearedFrom: string;
    /** Called by the insights editor hook after a save to route health signals. */
    applySaveResult: (result: SaveDailyInsightsResponse) => void;
    /** Reset transient signals when an insights save cycle restarts. */
    resetTransient: () => void;
    handleAcceptSuggestion: () => Promise<void>;
    dismissSuggestion: () => void;
    clearClearedFrom: () => void;
    dismissNoEscalation: () => void;
    /** Error callback — surfaced through the insights editor's error state. */
    onApplyError?: (message: string) => void;
    setApplyErrorHandler: (handler: (message: string) => void) => void;
}

export const useHealthSuggestion = (props: ReportViewProps): HealthSuggestionController => {
    const { data, type, reportId } = props;
    const analysis = (type === 'daily' ? (data as { analysis: DailyAnalysis }).analysis : (data as WeeklyAnalysis));
    const resolvedReportId =
        reportId ?? (type === 'weekly' ? (data as { id?: number }).id : undefined);

    const applyHealthMutation = useApplyInsightsHealth();

    const [localInsightsHealth, setLocalInsightsHealth] = useState<string>(analysis.insightsHealth || '');
    const [healthSuggestion, setHealthSuggestion] = useState<HealthSuggestion | null>(null);
    const [isApplyingHealth, setIsApplyingHealth] = useState<boolean>(false);
    const [healthCheckedNoEscalation, setHealthCheckedNoEscalation] = useState<boolean>(false);
    const [healthClearedFrom, setHealthClearedFrom] = useState<string>('');

    const [applyErrorHandler, setApplyErrorHandlerState] = useState<(message: string) => void>(
        () => () => {},
    );

    const applySaveResult = useCallback((result: SaveDailyInsightsResponse) => {
        if (result.healthSuggestion) {
            setHealthSuggestion(result.healthSuggestion);
        } else if (result.healthCleared) {
            setLocalInsightsHealth('');
            setHealthClearedFrom(result.clearedFrom || '');
            setTimeout(() => setHealthClearedFrom(''), 6000);
        } else {
            setHealthCheckedNoEscalation(true);
            setTimeout(() => setHealthCheckedNoEscalation(false), 5000);
        }
    }, []);

    const resetTransient = useCallback(() => {
        setHealthSuggestion(null);
        setHealthCheckedNoEscalation(false);
    }, []);

    const handleAcceptSuggestion = useCallback(async () => {
        if (!resolvedReportId || !healthSuggestion) return;
        setIsApplyingHealth(true);
        try {
            await applyHealthMutation.mutateAsync({
                id: resolvedReportId,
                insightsHealth: healthSuggestion.suggestedHealth,
                reason: healthSuggestion.reason,
            });
            setLocalInsightsHealth(healthSuggestion.suggestedHealth);
            setHealthSuggestion(null);
        } catch (err: unknown) {
            const message =
                (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                'Failed to apply health change.';
            applyErrorHandler(message);
        } finally {
            setIsApplyingHealth(false);
        }
    }, [resolvedReportId, healthSuggestion, applyHealthMutation, applyErrorHandler]);

    const setApplyErrorHandler = useCallback((handler: (message: string) => void) => {
        setApplyErrorHandlerState(() => handler);
    }, []);

    return {
        localInsightsHealth,
        healthSuggestion,
        isApplyingHealth,
        healthCheckedNoEscalation,
        healthClearedFrom,
        applySaveResult,
        resetTransient,
        handleAcceptSuggestion,
        dismissSuggestion: () => setHealthSuggestion(null),
        clearClearedFrom: () => setHealthClearedFrom(''),
        dismissNoEscalation: () => setHealthCheckedNoEscalation(false),
        setApplyErrorHandler,
    };
};

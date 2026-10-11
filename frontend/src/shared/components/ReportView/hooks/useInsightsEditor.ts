import { useState, useCallback, useEffect } from 'react';
import {
    useSaveDailyInsights,
    usePreviewInsights,
    useAcceptInsights,
} from '../../../../features/reports/daily/hooks';
import { useAuth } from '../../../../context/AuthContext';
import type {
    ReportViewProps,
    DailyAnalysis,
    WeeklyAnalysis,
    InsightsReportType,
} from '../types';
import type { HealthSuggestionController } from './useHealthSuggestion';

export interface InsightsEditorController {
    // Derived / identity
    resolvedReportId: number | undefined;
    canEditInsights: boolean;
    insightsAuthorName: string;
    /** True once a non-empty insight has been saved against this report. */
    hasSavedInsights: boolean;
    /** True if the current user is in a role that's allowed to edit insights for this report type. */
    baseRoleEligible: boolean;
    /** True if the current user is a superuser (allowed to override the one-and-done lock). */
    isSuperuser: boolean;

    // Editable state
    insightsText: string;
    setInsightsText: (text: string) => void;
    isEditing: boolean;
    beginEdit: () => void;
    cancelEdit: () => void;

    // Summary state (owned here because "accept" flow writes it)
    localExecutiveSummary: string;
    originalExecutiveSummary: string;
    showOriginalSummary: boolean;
    toggleOriginalSummary: () => void;

    // Save / refresh / accept
    isSaving: boolean;
    isRefreshing: boolean;
    isAccepting: boolean;
    insightsSaveError: string;
    insightsSaveSuccess: boolean;
    dismissSaveError: () => void;
    handleSaveInsights: () => Promise<void>;
    handleRefreshSummary: () => Promise<void>;
    handleAcceptSummary: () => Promise<void>;

    // One-and-done save confirmation
    confirmSaveOpen: boolean;
    requestSave: () => void;
    cancelConfirmSave: () => void;

    // Preview dialog state
    previewOpen: boolean;
    closePreview: () => void;
    proposedSummary: string;
}

/**
 * Owns the lifecycle of the Project Insights editor: local edit buffer, save/refresh/accept
 * flows, executive summary updates, and the refresh preview dialog. Delegates health signal
 * handling to the provided {@link HealthSuggestionController}.
 */
export const useInsightsEditor = (
    props: ReportViewProps,
    health: HealthSuggestionController,
): InsightsEditorController => {
    const { data, type, reportId, onInsightsSaved, isLead = false } = props;
    const { user } = useAuth();

    const analysis =
        type === 'daily'
            ? (data as { analysis: DailyAnalysis }).analysis
            : (data as WeeklyAnalysis);

    const resolvedReportId =
        reportId ?? (type === 'weekly' ? (data as { id?: number }).id : undefined);

    const reportTypeForApi: InsightsReportType =
        type === 'daily' ? 'daily' : 'weekly_project';

    // Author tracking / edit permission
    const insightsAuthorId: number | null =
        (data as { insightsAuthorId?: number | null }).insightsAuthorId ??
        analysis.insightsAuthorId ??
        null;
    const insightsAuthorName: string =
        (data as { insightsAuthorName?: string }).insightsAuthorName ??
        analysis.insightsAuthorName ??
        '';
    const currentUserId: number | null = user?.id ?? null;
    const userRoleName: string = (user?.roleName ?? '').toLowerCase();
    const isSuperuser =
        user?.role === 'SUPERUSER' || userRoleName === 'superuser';
    const isManagerOrAbove = isSuperuser || userRoleName === 'admin' || userRoleName === 'manager';

    // Authorization (mirrors backend insightsRoleGate + service-layer immutability):
    //   - daily reports  → lead, manager, admin, superuser
    //   - weekly reports → manager, admin, superuser   (leads cannot)
    //   - one-and-done   → once a non-empty insight exists, only superuser can change it
    const initialInsightsRaw =
        analysis.managerInsights ||
        (data as { managerInsights?: string }).managerInsights ||
        '';
    const hasSavedInsights = initialInsightsRaw.trim().length > 0;
    const baseRoleEligible = type === 'daily'
        ? (isManagerOrAbove || userRoleName === 'lead')
        : isManagerOrAbove;
    // Backwards compat: if a parent explicitly passes isLead=true (for safety) we still
    // honour that as a hard block on weekly. For daily, leads are explicitly allowed.
    const leadBlockedForType = isLead && type !== 'daily';
    const canEditInsights =
        baseRoleEligible
        && !leadBlockedForType
        && (!hasSavedInsights || isSuperuser)
        && (insightsAuthorId === null || insightsAuthorId === currentUserId || isSuperuser);

    // Exec summary buffer
    const [localExecutiveSummary, setLocalExecutiveSummary] = useState<string>(
        analysis.executiveSummary || '',
    );
    const originalExecutiveSummary: string = analysis.originalExecutiveSummary || '';
    const [showOriginalSummary, setShowOriginalSummary] = useState<boolean>(false);

    // Insights buffer (uses the same value already computed above for the immutability check)
    const initialInsights = initialInsightsRaw;
    const [insightsText, setInsightsText] = useState<string>(initialInsights);
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
    const [isAccepting, setIsAccepting] = useState<boolean>(false);
    const [insightsSaveError, setInsightsSaveError] = useState<string>('');
    const [insightsSaveSuccess, setInsightsSaveSuccess] = useState<boolean>(false);

    // Preview
    const [previewOpen, setPreviewOpen] = useState<boolean>(false);
    const [proposedSummary, setProposedSummary] = useState<string>('');

    // One-and-done confirmation. Saving an insight is irreversible for non-superusers
    // (enforced both server-side and via canEditInsights), so the Save button opens
    // a confirmation dialog instead of writing directly.
    const [confirmSaveOpen, setConfirmSaveOpen] = useState<boolean>(false);

    // Wire the health hook's "apply" errors back into this component's error slot so the
    // user sees a single error channel.
    useEffect(() => {
        health.setApplyErrorHandler(setInsightsSaveError);
    }, [health]);

    // Mutations
    const saveDailyInsightsMutation = useSaveDailyInsights();
    const previewInsightsMutation = usePreviewInsights();
    const acceptInsightsMutation = useAcceptInsights();

    const flashSuccess = useCallback(() => {
        setInsightsSaveSuccess(true);
        setTimeout(() => setInsightsSaveSuccess(false), 3000);
    }, []);

    const readError = (err: unknown, fallback: string): string =>
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

    const handleSaveInsights = useCallback(async () => {
        if (!resolvedReportId) return;
        setIsSaving(true);
        setInsightsSaveError('');
        setInsightsSaveSuccess(false);
        health.resetTransient();
        try {
            if (type === 'daily') {
                const result = await saveDailyInsightsMutation.mutateAsync({
                    id: resolvedReportId,
                    insights: insightsText,
                });
                health.applySaveResult(result);
            } else {
                await acceptInsightsMutation.mutateAsync({
                    reportType: reportTypeForApi,
                    id: resolvedReportId,
                    insights: insightsText,
                    newSummary: localExecutiveSummary,
                });
            }
            setIsEditing(false);
            flashSuccess();
            onInsightsSaved?.();
        } catch (err: unknown) {
            setInsightsSaveError(readError(err, 'Failed to save insights.'));
        } finally {
            setIsSaving(false);
            setConfirmSaveOpen(false);
        }
    }, [
        resolvedReportId,
        type,
        insightsText,
        localExecutiveSummary,
        reportTypeForApi,
        saveDailyInsightsMutation,
        acceptInsightsMutation,
        health,
        onInsightsSaved,
        flashSuccess,
    ]);

    const handleRefreshSummary = useCallback(async () => {
        if (!resolvedReportId || !insightsText.trim()) return;
        setIsRefreshing(true);
        setInsightsSaveError('');
        try {
            const result = await previewInsightsMutation.mutateAsync({
                reportType: reportTypeForApi,
                id: resolvedReportId,
                insights: insightsText,
            });
            setProposedSummary(result.newSummary);
            setPreviewOpen(true);
        } catch (err: unknown) {
            setInsightsSaveError(readError(err, 'Failed to generate refreshed summary.'));
        } finally {
            setIsRefreshing(false);
        }
    }, [resolvedReportId, insightsText, reportTypeForApi, previewInsightsMutation]);

    const handleAcceptSummary = useCallback(async () => {
        if (!resolvedReportId) return;
        setIsAccepting(true);
        try {
            await acceptInsightsMutation.mutateAsync({
                reportType: reportTypeForApi,
                id: resolvedReportId,
                insights: insightsText,
                newSummary: proposedSummary,
            });
            setLocalExecutiveSummary(proposedSummary);
            setIsEditing(false);
            setPreviewOpen(false);
            flashSuccess();
            onInsightsSaved?.();

            // Daily reports also re-run the insights-save so the health engine sees the new
            // summary and can escalate if warranted.
            if (type === 'daily' && insightsText.trim()) {
                health.resetTransient();
                saveDailyInsightsMutation
                    .mutateAsync({ id: resolvedReportId, insights: insightsText })
                    .then(result => health.applySaveResult(result))
                    .catch(() => {
                        /* non-fatal */
                    });
            }
        } catch (err: unknown) {
            setInsightsSaveError(readError(err, 'Failed to save accepted summary.'));
        } finally {
            setIsAccepting(false);
        }
    }, [
        resolvedReportId,
        type,
        insightsText,
        proposedSummary,
        reportTypeForApi,
        acceptInsightsMutation,
        saveDailyInsightsMutation,
        health,
        onInsightsSaved,
        flashSuccess,
    ]);

    const beginEdit = useCallback(() => setIsEditing(true), []);
    const cancelEdit = useCallback(() => {
        setIsEditing(false);
        setInsightsText(initialInsights);
        setInsightsSaveError('');
    }, [initialInsights]);

    const requestSave = useCallback(() => setConfirmSaveOpen(true), []);
    const cancelConfirmSave = useCallback(() => setConfirmSaveOpen(false), []);

    const toggleOriginalSummary = useCallback(
        () => setShowOriginalSummary(v => !v),
        [],
    );

    const closePreview = useCallback(() => {
        if (!isAccepting) setPreviewOpen(false);
    }, [isAccepting]);

    return {
        resolvedReportId,
        canEditInsights,
        insightsAuthorName,
        hasSavedInsights,
        baseRoleEligible,
        isSuperuser,

        insightsText,
        setInsightsText,
        isEditing,
        beginEdit,
        cancelEdit,

        localExecutiveSummary,
        originalExecutiveSummary,
        showOriginalSummary,
        toggleOriginalSummary,

        isSaving,
        isRefreshing,
        isAccepting,
        insightsSaveError,
        insightsSaveSuccess,
        dismissSaveError: () => setInsightsSaveError(''),
        handleSaveInsights,
        handleRefreshSummary,
        handleAcceptSummary,

        confirmSaveOpen,
        requestSave,
        cancelConfirmSave,

        previewOpen,
        closePreview,
        proposedSummary,
    };
};

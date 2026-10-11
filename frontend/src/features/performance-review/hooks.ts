import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../api/client';
import { performanceReviewKeys } from '../../shared/queryKeys';
import type {
  IdentityOverview,
  IdentityCoverage,
  SeedResult,
  BulkConfirmResult,
  ReviewConfigResponse,
  ReviewCycleConfig,
  ProjectSettings,
  PreviewedCycle,
  CompetencyTemplate,
  TemplateStatus,
  ReviewAssignment,
  LeadReviewDetail,
  RatingInput,
  ReviewCycle,
  CycleSource,
  CycleParticipant,
  EligibleReviewersByMember,
  ReviewMemberScoreRow,
  CycleStatus,
  MyReviewsResponse,
  PendingReviewStatus,
  MyReviewDetail,
  TeamMemberHistory,
} from './types';

const BASE = '/performance-review';

// --- queries ----------------------------------------------------------------

/** Unresolved identities plus the coverage gate, weakest match first. */
export const useIdentityOverview = (projectId: number | null) =>
  useQuery({
    queryKey: performanceReviewKeys.identity(projectId ?? 0),
    queryFn: async () =>
      (await client.get<IdentityOverview>(`${BASE}/identity/project/${projectId}`)).data,
    enabled: !!projectId,
  });

// --- mutations --------------------------------------------------------------

/**
 * Every mutation here changes the gate, so they all invalidate the overview.
 * Confirmations additionally resolve the same person in sibling projects, which
 * the caller surfaces via `propagatedToProjects` — invalidating the whole
 * `performance-review` tree keeps other projects' cached coverage honest.
 */
const useIdentityMutation = <TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: performanceReviewKeys.all });
    },
  });
};

/** Re-run the matcher. Idempotent; never overwrites a human decision. */
export const useSeedIdentities = () =>
  useIdentityMutation(async (projectId: number) =>
    (await client.post<SeedResult>(`${BASE}/identity/project/${projectId}/seed`)).data,
  );

/** Confirm or reject one suggestion, optionally repointing it to another member. */
export const useDecideIdentityLink = () =>
  useIdentityMutation(
    async (args: { linkId: number; decision: 'confirm' | 'reject'; teamMemberId?: number }) =>
      (
        await client.patch(`${BASE}/identity/links/${args.linkId}`, {
          decision: args.decision,
          teamMemberId: args.teamMemberId,
        })
      ).data,
  );

/** Link an identity by hand, for one the matcher could not resolve. */
export const useCreateIdentityLink = () =>
  useIdentityMutation(
    async (args: {
      projectId: number;
      teamMemberId: number;
      sourceKey: string;
      sourceDisplayName?: string | null;
    }) => (await client.post(`${BASE}/identity/links`, args)).data,
  );

/** Mark one identity as not a reviewable team member. */
export const useRejectIdentity = () =>
  useIdentityMutation(
    async (args: { projectId: number; sourceKey: string; sourceDisplayName?: string | null }) =>
      (await client.post(`${BASE}/identity/reject`, args)).data,
  );

/** Confirm every unambiguous suggestion (>= 0.9) in one action. */
export const useBulkConfirm = () =>
  useIdentityMutation(
    async (args: { projectId: number; minConfidence?: number }) =>
      (
        await client.post<BulkConfirmResult>(
          `${BASE}/identity/project/${args.projectId}/bulk-confirm`,
          { minConfidence: args.minConfidence },
        )
      ).data,
  );

/** Re-apply confirmed links to historical score rows. Idempotent. */
export const useBackfillIdentities = () =>
  useIdentityMutation(
    async (projectId: number) =>
      (
        await client.post<{ updatedRows: number; coverage: IdentityCoverage }>(
          `${BASE}/identity/project/${projectId}/backfill`,
        )
      ).data,
  );

// ── Configuration & rollout ─────────────────────────────────────────────────

/** Account config plus every project's rollout readiness. */
export const useReviewConfig = (accountId: number | null | undefined) =>
  useQuery({
    queryKey: performanceReviewKeys.config(accountId ?? 0),
    queryFn: async () =>
      (await client.get<ReviewConfigResponse>(`${BASE}/config/account/${accountId}`)).data,
    enabled: !!accountId,
  });

/**
 * Save the config, including `scopeProjectIds` — the per-project rollout list.
 *
 * A project may be added regardless of identity resolution state (Phase 8) —
 * only resolved people are ever scored, so this never rejects on that basis.
 * `scopeProjectIds` is a full replace, not a diff — pass the whole desired list.
 */
export const useSaveReviewConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { accountId: number; config: Partial<ReviewCycleConfig> }) =>
      (await client.put<ReviewCycleConfig>(`${BASE}/config/account/${args.accountId}`, args.config)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceReviewKeys.all }),
  });
};

/** This project's setup overrides — competency template, default reviewer, and who's eligible. */
export const useProjectSettings = (projectId: number | null) =>
  useQuery({
    queryKey: [...performanceReviewKeys.all, 'project-settings', projectId ?? 0] as const,
    queryFn: async () =>
      (await client.get<ProjectSettings>(`${BASE}/project-settings/${projectId}`)).data,
    enabled: !!projectId,
  });

/**
 * Point a project at a specific competency template and/or default reviewer.
 * Both fields are a full replace, not a diff — pass the current value for
 * whichever one isn't being changed.
 */
export const useSaveProjectSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { projectId: number; templateId: number | null; defaultReviewerUserId?: number | null }) =>
      (await client.put<ProjectSettings>(`${BASE}/project-settings/${args.projectId}`, {
        templateId: args.templateId,
        defaultReviewerUserId: args.defaultReviewerUserId,
      })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceReviewKeys.all }),
  });
};

/** Dry-run the cadence before writing anything. */
export const usePreviewCycles = (
  accountId: number | null | undefined,
  from: string,
  to: string,
  enabled = true,
) =>
  useQuery({
    queryKey: performanceReviewKeys.previewCycles(accountId ?? 0, from, to),
    queryFn: async () =>
      (
        await client.get<PreviewedCycle[]>(`${BASE}/config/account/${accountId}/preview-cycles`, {
          params: { from, to },
        })
      ).data,
    enabled: !!accountId && !!from && !!to && enabled,
  });

/** Materialise cycles. Idempotent; backfills from the account's setupDate (or fiscal-year start if unset). */
export const useGenerateCycles = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { accountId: number; upTo: string; from?: string }) =>
      (await client.post<{ created: number; skipped: number }>(`${BASE}/cycles/generate`, args)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceReviewKeys.all }),
  });
};

/** One-off period covering several skipped pre-setup months, superuser only. */
export const useGenerateCatchUpCycle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { accountId: number; startDate: string; endDate: string }) =>
      (await client.post<ReviewCycle>(`${BASE}/cycles/catch-up`, args)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceReviewKeys.all }),
  });
};

export const useCycles = (accountId: number | null | undefined, year?: string, includeHistorical = false) =>
  useQuery({
    queryKey: [...performanceReviewKeys.cycles(accountId ?? 0, year), includeHistorical] as const,
    queryFn: async () =>
      (await client.get<any[]>(`${BASE}/cycles`, { params: { accountId, year, includeHistorical } })).data,
    enabled: !!accountId,
  });

// ── Competency templates ────────────────────────────────────────────────────

const invalidateAll = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient.invalidateQueries({ queryKey: performanceReviewKeys.all });

export const useTemplates = (accountId?: number | null) =>
  useQuery({
    queryKey: performanceReviewKeys.templates(accountId ?? undefined),
    queryFn: async () =>
      (await client.get<CompetencyTemplate[]>(`${BASE}/templates/competency`, {
        params: accountId ? { accountId } : {},
      })).data,
  });

export const useSaveTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id?: number; body: Partial<CompetencyTemplate> & { items: any[] } }) =>
      args.id
        ? (await client.put<CompetencyTemplate>(`${BASE}/templates/competency/${args.id}`, args.body)).data
        : (await client.post<CompetencyTemplate>(`${BASE}/templates/competency`, args.body)).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

/** The only way to change a template that has already been answered. */
export const useVersionTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await client.post<CompetencyTemplate>(`${BASE}/templates/competency/${id}/version`)).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

export const useSetTemplateStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: number; status: TemplateStatus }) =>
      (await client.post<CompetencyTemplate>(`${BASE}/templates/competency/${args.id}/status`, {
        status: args.status,
      })).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

// ── Lead reviews ────────────────────────────────────────────────────────────

/** The reviewer's worklist for a cycle. */
export const useReviewAssignments = (cycleId: number | null) =>
  useQuery({
    queryKey: performanceReviewKeys.assignments(cycleId ?? 0),
    queryFn: async () =>
      (await client.get<ReviewAssignment[]>(`${BASE}/cycles/${cycleId}/lead-reviews`)).data,
    enabled: !!cycleId,
  });

export const useLeadReview = (reviewId: number | null) =>
  useQuery({
    queryKey: performanceReviewKeys.leadReview(reviewId ?? 0),
    queryFn: async () => (await client.get<LeadReviewDetail>(`${BASE}/lead-reviews/${reviewId}`)).data,
    enabled: !!reviewId,
  });

/** Open (or lazily create) the draft for one participant. */
export const useOpenReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { cycleId: number; teamMemberId: number }) =>
      (await client.post<LeadReviewDetail>(
        `${BASE}/cycles/${args.cycleId}/lead-reviews/${args.teamMemberId}/open`,
      )).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

/**
 * Autosave.
 *
 * Deliberately does NOT invalidate on success: the response already carries the
 * fresh state, and refetching mid-typing would fight the user's cursor.
 */
export const useSaveLeadReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      reviewId: number;
      strengths?: string | null;
      improvements?: string | null;
      overallComment?: string | null;
      ratings?: RatingInput[];
    }) => {
      const { reviewId, ...body } = args;
      return (await client.put<LeadReviewDetail>(`${BASE}/lead-reviews/${reviewId}`, body)).data;
    },
    onSuccess: data =>
      queryClient.setQueryData(performanceReviewKeys.leadReview(data.review.id), data),
  });
};

export const useSubmitLeadReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reviewId: number) =>
      (await client.post<LeadReviewDetail>(`${BASE}/lead-reviews/${reviewId}/submit`)).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

export const usePublishLeadReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reviewId: number) =>
      (await client.post<LeadReviewDetail>(`${BASE}/lead-reviews/${reviewId}/publish`)).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

/** Correct a published review. Creates a superseding version; reason required. */
export const useReviseLeadReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { reviewId: number; reason: string }) =>
      (await client.post<LeadReviewDetail>(`${BASE}/lead-reviews/${args.reviewId}/revise`, {
        reason: args.reason,
      })).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

// ── Cycle administration ─────────────────────────────────────────────────────

export const useCycle = (cycleId: number | null) =>
  useQuery({
    queryKey: [...performanceReviewKeys.all, 'cycle', cycleId ?? 0] as const,
    queryFn: async () =>
      (await client.get<{ cycle: ReviewCycle; permissions: Record<string, boolean> }>(
        `${BASE}/cycles/${cycleId}`,
      )).data,
    enabled: !!cycleId,
  });

/**
 * Move a cycle through scheduled → open → locked → published (or archived).
 *
 * `open` on a `scheduled` cycle triggers the full open sequence server-side
 * (snapshot config, attach sources, freeze participants, score); `locked`
 * re-scores once more before freezing; `published` is the one-way door that makes
 * scores and reviews visible to members.
 */
export const useTransitionCycle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { cycleId: number; toStatus: CycleStatus; note?: string }) =>
      (await client.post<ReviewCycle>(`${BASE}/cycles/${args.cycleId}/transition`, {
        toStatus: args.toStatus,
        note: args.note,
      })).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

export const useRecomputeCycle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cycleId: number) =>
      (await client.post(`${BASE}/cycles/${cycleId}/recompute`)).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

export const useCycleSources = (cycleId: number | null) =>
  useQuery({
    queryKey: [...performanceReviewKeys.all, 'cycle-sources', cycleId ?? 0] as const,
    queryFn: async () => (await client.get<CycleSource[]>(`${BASE}/cycles/${cycleId}/sources`)).data,
    enabled: !!cycleId,
  });

/** Include or exclude one attached sprint. A reason is required to exclude. */
export const useUpdateCycleSource = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { cycleId: number; sourceId: number; excluded: boolean; reason?: string }) =>
      (await client.patch<CycleSource>(`${BASE}/cycles/${args.cycleId}/sources/${args.sourceId}`, {
        excluded: args.excluded,
        reason: args.reason,
      })).data,
    onSuccess: () => invalidateAll(queryClient),
  });
};

export const useCycleParticipants = (cycleId: number | null) =>
  useQuery({
    queryKey: [...performanceReviewKeys.all, 'cycle-participants', cycleId ?? 0] as const,
    queryFn: async () =>
      (await client.get<CycleParticipant[]>(`${BASE}/cycles/${cycleId}/participants`)).data,
    enabled: !!cycleId,
  });

/** Who could plausibly review each participant, scoped to their contributing projects. */
export const useEligibleReviewers = (cycleId: number | null) =>
  useQuery({
    queryKey: [...performanceReviewKeys.all, 'eligible-reviewers', cycleId ?? 0] as const,
    queryFn: async () =>
      (await client.get<EligibleReviewersByMember>(`${BASE}/cycles/${cycleId}/eligible-reviewers`)).data,
    enabled: !!cycleId,
  });

/** Assign (or clear) a reviewer, or exclude a participant from the cycle. */
export const useUpdateParticipant = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      participantId: number;
      reviewerUserId?: number | null;
      isExcluded?: boolean;
      exclusionReason?: string | null;
    }) => {
      const { participantId, ...body } = args;
      return (await client.patch<CycleParticipant>(`${BASE}/participants/${participantId}`, body)).data;
    },
    onSuccess: () => invalidateAll(queryClient),
  });
};

export const useCycleScores = (cycleId: number | null) =>
  useQuery({
    queryKey: [...performanceReviewKeys.all, 'cycle-scores', cycleId ?? 0] as const,
    queryFn: async () =>
      (await client.get<ReviewMemberScoreRow[]>(`${BASE}/cycles/${cycleId}/scores`)).data,
    enabled: !!cycleId,
  });

// ── Member self-service ───────────────────────────────────────────────────────

/**
 * Dashboard-sized summary: the caller's own pending-review status, and, when
 * they're also a reviewer, how many of their assignments are unstarted.
 * Cheap enough to call unconditionally from a general dashboard card — most
 * viewers have no performance-review involvement at all, in which case both
 * fields come back null and the card renders nothing.
 */
export const usePendingReviewStatus = () =>
  useQuery({
    queryKey: [...performanceReviewKeys.all, 'pending-status'] as const,
    queryFn: async () => (await client.get<PendingReviewStatus>(`${BASE}/me/pending-status`)).data,
  });

/** Every published review for the signed-in member, oldest first, with the trend series. */
export const useMyReviews = () =>
  useQuery({
    queryKey: performanceReviewKeys.myReviews(),
    queryFn: async () => (await client.get<MyReviewsResponse>(`${BASE}/me/reviews`)).data,
  });

export const useMyReview = (cycleId: number | null) =>
  useQuery({
    queryKey: [...performanceReviewKeys.myReviews(), cycleId ?? 0] as const,
    queryFn: async () => (await client.get<MyReviewDetail>(`${BASE}/me/reviews/${cycleId}`)).data,
    enabled: !!cycleId,
  });

/** Record that the member has seen a published review. Idempotent server-side. */
export const useAcknowledgeReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { reviewId: number; comment?: string | null }) =>
      (await client.post(`${BASE}/me/reviews/${args.reviewId}/acknowledge`, { comment: args.comment })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: performanceReviewKeys.myReviews() }),
  });
};

// ── Team member history (a lead's cross-team view) ──────────────────────────

/**
 * A team member's full history — authorized against whoever is currently
 * assigned to review them; periods authored by a different lead come back with
 * `review.redacted: true` and no narrative/rating fields at all.
 */
export const useTeamMemberHistory = (teamMemberId: number | null) =>
  useQuery({
    queryKey: [...performanceReviewKeys.all, 'team-member-history', teamMemberId ?? 0] as const,
    queryFn: async () =>
      (await client.get<TeamMemberHistory>(`${BASE}/team-members/${teamMemberId}/history`)).data,
    enabled: !!teamMemberId,
  });

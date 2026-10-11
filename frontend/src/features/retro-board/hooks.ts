/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../api/client';
import { retroKeys } from '../../shared/queryKeys';
import type {
  RetroBoard, RetroBoardDetail, RetroComment, RetroItem, RetroSummary,
  CarryForward, AgreedPointsHistory, RetroOutcome,
} from './types';

// --- fetchers ---------------------------------------------------------------
const listBoards = async (projectId?: number) =>
  (await client.get<any>('/retro/boards', { params: projectId ? { projectId } : {} })).data.data as RetroBoard[];

const getBoard = async (boardId: number) =>
  (await client.get<any>(`/retro/boards/${boardId}`)).data.data as RetroBoardDetail;

const getBoardByToken = async (token: string) =>
  (await client.get<any>(`/retro/boards/by-token/${token}`)).data.data as RetroBoardDetail;

const getSummary = async (boardId: number) =>
  (await client.get<any>(`/retro/boards/${boardId}/summary`)).data.data as RetroSummary;

const listComments = async (itemId: number) =>
  (await client.get<any>(`/retro/items/${itemId}/comments`)).data.data as RetroComment[];

// --- queries ----------------------------------------------------------------
export const useRetroBoards = (projectId?: number) =>
  useQuery({
    queryKey: retroKeys.boards(projectId),
    queryFn: () => listBoards(projectId),
  });

/**
 * The live board query.
 *
 * Overrides the app-wide defaults from main.tsx (staleTime 30s,
 * refetchOnWindowFocus false), which are tuned against liveness and would make
 * a shared board feel broken. When the socket is connected we rely on pushed
 * deltas and disable polling entirely; when it is not, a 5s poll keeps the
 * board correct — every write is REST either way, so the degraded mode loses
 * latency and nothing else.
 */
export const useRetroBoard = (boardId?: number | null, socketConnected = false) =>
  useQuery({
    queryKey: retroKeys.board(boardId ?? 0),
    queryFn: () => getBoard(boardId as number),
    enabled: !!boardId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: socketConnected ? false : 5_000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

export const useRetroBoardByToken = (token?: string) =>
  useQuery({
    queryKey: retroKeys.byToken(token ?? ''),
    queryFn: () => getBoardByToken(token as string),
    enabled: !!token,
    staleTime: 0,
    retry: 1,
  });

export const useRetroSummary = (boardId?: number | null, enabled = true) =>
  useQuery({
    queryKey: retroKeys.summary(boardId ?? 0),
    queryFn: () => getSummary(boardId as number),
    enabled: !!boardId && enabled,
  });

export const useRetroComments = (itemId?: number | null) =>
  useQuery({
    queryKey: retroKeys.comments(itemId ?? 0),
    queryFn: () => listComments(itemId as number),
    enabled: !!itemId,
  });

// --- mutations --------------------------------------------------------------
/**
 * Invalidate the board this mutation touched. Cheap and always correct; the
 * socket handlers do the fine-grained cache patching for other users' changes.
 */
const useBoardInvalidation = () => {
  const qc = useQueryClient();
  return (boardId: number) => {
    qc.invalidateQueries({ queryKey: retroKeys.board(boardId) });
    qc.invalidateQueries({ queryKey: retroKeys.summary(boardId) });
  };
};

export const useCreateRetroBoard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await client.post<any>('/retro/boards', data)).data.data as RetroBoard,
    onSuccess: () => qc.invalidateQueries({ queryKey: retroKeys.all }),
  });
};

export const useUpdateRetroBoard = () => {
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ boardId, data }: { boardId: number; data: any }) =>
      (await client.patch<any>(`/retro/boards/${boardId}`, data)).data.data as RetroBoard,
    onSuccess: (_r, { boardId }) => invalidate(boardId),
  });
};

export const useUpdateRetroLanes = () => {
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ boardId, lanes, reassign }: { boardId: number; lanes: any[]; reassign?: Record<string, string> }) =>
      (await client.put<any>(`/retro/boards/${boardId}/lanes`, { lanes, reassign })).data.data as RetroBoard,
    onSuccess: (_r, { boardId }) => invalidate(boardId),
  });
};

export const useChangeRetroStatus = () => {
  const qc = useQueryClient();
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ boardId, status }: { boardId: number; status: string }) =>
      (await client.post<any>(`/retro/boards/${boardId}/status`, { status })).data.data as RetroBoard,
    onSuccess: (_r, { boardId }) => {
      invalidate(boardId);
      qc.invalidateQueries({ queryKey: retroKeys.all });
    },
  });
};

export const useJoinRetroBoard = () =>
  useMutation({
    mutationFn: async (boardId: number) =>
      (await client.post<any>(`/retro/boards/${boardId}/join`, {})).data.data,
  });

export const useCreateRetroItem = () => {
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ boardId, data }: { boardId: number; data: any }) =>
      (await client.post<any>(`/retro/boards/${boardId}/items`, data)).data.data as RetroItem,
    onSuccess: (_r, { boardId }) => invalidate(boardId),
  });
};

export const useUpdateRetroItem = () => {
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ itemId, data }: { itemId: number; boardId: number; data: any }) =>
      (await client.patch<any>(`/retro/items/${itemId}`, data)).data.data as RetroItem,
    onSuccess: (_r, { boardId }) => invalidate(boardId),
  });
};

export const useDeleteRetroItem = () => {
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ itemId }: { itemId: number; boardId: number }) =>
      (await client.delete<any>(`/retro/items/${itemId}`)).data.data,
    onSuccess: (_r, { boardId }) => invalidate(boardId),
  });
};

export const useToggleRetroVote = () => {
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ itemId }: { itemId: number; boardId: number }) =>
      (await client.post<any>(`/retro/items/${itemId}/vote`, {})).data.data as RetroItem,
    onSuccess: (_r, { boardId }) => invalidate(boardId),
  });
};

export const useSetTopPick = () => {
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ itemId, rank }: { itemId: number; boardId: number; rank: number | null }) =>
      (await client.put<any>(`/retro/items/${itemId}/top-pick`, { rank })).data.data as RetroItem,
    onSuccess: (_r, { boardId }) => invalidate(boardId),
  });
};

export const useCreateRetroComment = () => {
  const qc = useQueryClient();
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ itemId, data }: { itemId: number; boardId: number; data: any }) =>
      (await client.post<any>(`/retro/items/${itemId}/comments`, data)).data.data as RetroComment,
    onSuccess: (_r, { itemId, boardId }) => {
      qc.invalidateQueries({ queryKey: retroKeys.comments(itemId) });
      invalidate(boardId);
    },
  });
};

export const useDeleteRetroComment = () => {
  const qc = useQueryClient();
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ commentId }: { commentId: number; itemId: number; boardId: number }) =>
      (await client.delete<any>(`/retro/comments/${commentId}`)).data.data,
    onSuccess: (_r, { itemId, boardId }) => {
      qc.invalidateQueries({ queryKey: retroKeys.comments(itemId) });
      invalidate(boardId);
    },
  });
};

export const useConvertToActionItem = () => {
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ itemId, data }: { itemId: number; boardId: number; data: any }) =>
      (await client.post<any>(`/retro/items/${itemId}/convert/action-item`, data)).data.data,
    onSuccess: (_r, { boardId }) => invalidate(boardId),
  });
};

export const useConvertToRisk = () => {
  const invalidate = useBoardInvalidation();
  return useMutation({
    mutationFn: async ({ itemId, data }: { itemId: number; boardId: number; data: any }) =>
      (await client.post<any>(`/retro/items/${itemId}/convert/risk`, data)).data.data,
    onSuccess: (_r, { boardId }) => invalidate(boardId),
  });
};

// --- Continuity between retros ----------------------------------------------

const getCarryForward = async (boardId: number) =>
  (await client.get<any>(`/retro/boards/${boardId}/carry-forward`)).data.data as CarryForward;

const getAgreedPoints = async (projectId: number) =>
  (await client.get<any>(`/retro/projects/${projectId}/agreed-points`)).data.data as AgreedPointsHistory;

const setOutcome = async (boardId: number, itemId: number, outcome: RetroOutcome, note?: string) =>
  (await client.put<any>(`/retro/boards/${boardId}/carry-forward/${itemId}/outcome`, { outcome, note }))
    .data.data as CarryForward;

export const useCarryForward = (boardId?: number | null) =>
  useQuery({
    queryKey: retroKeys.carryForward(boardId ?? 0),
    queryFn: () => getCarryForward(boardId as number),
    enabled: !!boardId,
  });

export const useAgreedPoints = (projectId?: number | null) =>
  useQuery({
    queryKey: retroKeys.agreedPoints(projectId ?? 0),
    queryFn: () => getAgreedPoints(projectId as number),
    enabled: !!projectId,
  });

export const useSetOutcome = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, itemId, outcome, note }:
      { boardId: number; itemId: number; outcome: RetroOutcome; note?: string }) =>
      setOutcome(boardId, itemId, outcome, note),
    onSuccess: (data, { boardId }) => {
      // The mutation returns the refreshed carry-forward, so seed it directly
      // rather than round-tripping.
      qc.setQueryData(retroKeys.carryForward(boardId), data);
      // The history view groups these points, so its badges are now stale.
      qc.invalidateQueries({ queryKey: [...retroKeys.all, 'agreedPoints'] });
    },
  });
};

/**
 * Convert a point carried forward from a PREVIOUS retro.
 *
 * Deliberately not useConvertToActionItem/useConvertToRisk: those post to
 * /items/:itemId/convert/*, which the server authorises against the board that
 * OWNS the item — the frozen previous board. A different lead running this
 * retro would be refused there. This route authorises against the reviewing
 * board instead, which is the whole reason it exists.
 */
const convertCarriedPoint = async (
  boardId: number, itemId: number, target: 'action-item' | 'risk', data: unknown
) =>
  (await client.post<any>(`/retro/boards/${boardId}/carry-forward/${itemId}/convert/${target}`, data))
    .data.data as CarryForward;

export const useConvertCarriedPoint = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, itemId, target, data }:
      { boardId: number; itemId: number; target: 'action-item' | 'risk'; data: unknown }) =>
      convertCarriedPoint(boardId, itemId, target, data),
    onSuccess: (data, { boardId }) => {
      // Same shape as useSetOutcome: the server hands back the refreshed
      // carry-forward, so the newly linked work shows up without a refetch.
      qc.setQueryData(retroKeys.carryForward(boardId), data);
      qc.invalidateQueries({ queryKey: [...retroKeys.all, 'agreedPoints'] });
    },
  });
};

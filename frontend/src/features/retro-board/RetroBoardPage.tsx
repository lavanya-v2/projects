/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, Divider, Paper, Snackbar,
  Tooltip, Typography,
} from '@mui/material';
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  ContentCopyRounded, PictureAsPdfRounded, WifiTetheringRounded, SyncProblemRounded,
  PlayArrowRounded, CheckCircleRounded, ArrowBackRounded, SettingsRounded,
} from '@mui/icons-material';
import RetroLane from './RetroLane';
import RetroItemCard from './RetroItemCard';
import RetroItemDetailModal from './RetroItemDetailModal';
import ConvertItemModal from './ConvertItemModal';
import RetroPdfDocument from './RetroPdfDocument';
import TopPicksPanel from './TopPicksPanel';
import CarryForwardPanel from './CarryForwardPanel';
import BoardSettingsModal from './BoardSettingsModal';
import { useRetroSocket } from './realtime/useRetroSocket';
import {
  useRetroBoardByToken, useRetroBoard, useCreateRetroItem, useDeleteRetroItem,
  useToggleRetroVote, useUpdateRetroItem, useChangeRetroStatus, useJoinRetroBoard,
  useRetroSummary, useSetTopPick, useUpdateRetroBoard, useCarryForward, useSetOutcome,
} from './hooks';
import { usePermissions } from '../../shared/hooks/usePermissions';
import { PATHS } from '../../routes/paths';
import { usePdfExport } from '../reports/portfolio/presentation/hooks/usePdfExport';
import { STATUS_COLORS, STATUS_LABELS, type CarriedPoint, type RetroItem } from './types';
import { ConfirmDeleteDialog } from '../admin/accounts/components/dialogs/ConfirmDeleteDialog';

export default function RetroBoardPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  // Matches the guard on the list route: only lead-and-above have a Retro
  // Boards listing to go back to. A member who opened a share link has no such
  // page, so offering them a back link would just 403 them.
  const { canCreateRetroBoard } = usePermissions();

  const tokenQuery = useRetroBoardByToken(token);
  const boardId = tokenQuery.data?.board.id;

  // Realtime first; the board query below disables its poll while connected.
  const { connected, participants: livePresence } = useRetroSocket(boardId);
  const boardQuery = useRetroBoard(boardId, connected);

  const detail = boardQuery.data ?? tokenQuery.data;

  const [activeItem, setActiveItem] = useState<RetroItem | null>(null);
  const [openItem, setOpenItem] = useState<RetroItem | null>(null);
  const [convertItem, setConvertItem] = useState<RetroItem | null>(null);
  // Kept separate from convertItem: a carried point comes from a different,
  // frozen board and submits through a different route.
  const [convertCarried, setConvertCarried] = useState<CarriedPoint | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wantPdf, setWantPdf] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [deleteMessage, setDeleteMessage] =  useState<RetroItem | null>(null);

  const createItem = useCreateRetroItem();
  const deleteItem = useDeleteRetroItem();
  const toggleVote = useToggleRetroVote();
  const updateItem = useUpdateRetroItem();
  const changeStatus = useChangeRetroStatus();
  const joinBoard = useJoinRetroBoard();
  const setTopPick = useSetTopPick();
  const setOutcome = useSetOutcome();
  const updateBoard = useUpdateRetroBoard();

  const carryForwardQuery = useCarryForward(boardId);
  const summaryQuery = useRetroSummary(boardId, wantPdf);
  const pdf = usePdfExport();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const hasJoined = useRef(false);

  // Record attendance once the board resolves, so the PDF has an attendee list
  // even for people who only read.
  useEffect(() => {
  if (boardId && !hasJoined.current) {
    hasJoined.current = true;
    joinBoard.mutateAsync(boardId).catch(() => {});
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [boardId]);

  // Fire the download once the summary for it has actually loaded, so the
  // document never rasterises against half-loaded data.
  useEffect(() => {
    if (wantPdf && summaryQuery.isSuccess && !pdf.generating) {
      const name = `retro-${detail?.board.projectName ?? 'board'}-${detail?.board.meetingDate ?? ''}.pdf`
        .replace(/\s+/g, '_');
      pdf.download(name).finally(() => setWantPdf(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantPdf, summaryQuery.isSuccess]);

  const itemsByLane = useMemo(() => {
    const map = new Map<string, RetroItem[]>();
    for (const item of detail?.items ?? []) {
      const list = map.get(item.laneKey) ?? [];
      list.push(item);
      map.set(item.laneKey, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [detail?.items]);

  if (tokenQuery.isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
  }

  if (tokenQuery.isError) {
    const status = (tokenQuery.error as any)?.response?.status;
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Alert severity={status === 403 ? 'warning' : 'error'} data-testid="board-access-error">
          {status === 403
            ? 'You do not have access to this retro board. It belongs to a project outside your scope, or has not been opened yet.'
            : status === 404
              ? 'This retro board no longer exists.'
              : 'Could not load this retro board.'}
        </Alert>
      </Container>
    );
  }

  if (!detail) return null;

  const { board } = detail;
  const readOnly = !board.permissions.canAddItems;
  const overBudget = board.votesPerUser > 0 && detail.myVotesUsed > board.votesPerUser;

  const showError = (e: unknown, fallback: string) =>
    setError((e as any)?.response?.data?.error ?? fallback);

  const handleAdd = async (laneKey: string, content: string, isAnonymous: boolean) => {
    try {
      await createItem.mutateAsync({ boardId: board.id, data: { laneKey, content, isAnonymous } });
    } catch (e) { showError(e, 'Could not add the item'); }
  };

  const handleVote = async (item: RetroItem) => {
    try {
      await toggleVote.mutateAsync({ itemId: item.id, boardId: board.id });
    } catch (e) { showError(e, 'Could not record your vote'); }
  };

  const handleDragStart = (e: DragStartEvent) => setActiveItem(e.active.data.current?.item ?? null);

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveItem(null);
    const item: RetroItem | undefined = e.active.data.current?.item;
    const laneKey = e.over?.id as string | undefined;
    if (!item || !laneKey || laneKey === item.laneKey) return;
    if (!item.permissions.canMove) return;
    try {
      await updateItem.mutateAsync({ itemId: item.id, boardId: board.id, data: { laneKey } });
    } catch (err) { showError(err, 'Could not move the item'); }
  };

  const advance = async (status: string) => {
    try {
      await changeStatus.mutateAsync({ boardId: board.id, status });
      setToast(status === 'ACTIVE' ? 'Board is now live' : 'Retro completed and frozen');
    } catch (e) { showError(e, 'Could not change the board status'); }
  };

  const handleRemoveBox = async (item: RetroItem) => {
    setIsOpen(true);
    setDeleteMessage(item);
  };

  const handleRemove = async () => {
    if (!deleteMessage) return;
    try {
      await deleteItem.mutateAsync({ itemId: deleteMessage.id, boardId: board.id });
      setToast('Item removed');
      setDeleteMessage(null);
      setIsOpen(false);
    } catch (e) { showError(e, 'Could not remove the item'); }
  };

  const presence = livePresence.length > 0 ? livePresence : detail.participants;

  return (
    <Container maxWidth={false} sx={{ py: 3 }}>
      {/* Header */}
      <Paper sx={{ p: 2, mb: 2 }}>
        {canCreateRetroBoard && (
          <Button
            size="small"
            startIcon={<ArrowBackRounded />}
            onClick={() => navigate(PATHS.RETRO_BOARDS)}
            data-testid="back-to-list"
            sx={{ mb: 1, ml: -1 }}
          >
            All retro boards
          </Button>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{board.title}</Typography>
          <Chip
            size="small"
            label={STATUS_LABELS[board.status]}
            data-testid="board-status"
            sx={{ bgcolor: STATUS_COLORS[board.status], color: '#fff', fontWeight: 600 }}
          />
          {/* Connection state, NOT board state. Two separate fixes live here:
              1. It renders only while the board is ACTIVE. Elsewhere it is
                 noise at best and a contradiction at worst — beside the status
                 chip, "Completed · Live" reads as two claims about the retro.
              2. It says "Synced", not "Live". The ACTIVE board status is itself
                 labelled "Live" (STATUS_LABELS), so the old wording rendered
                 "Live · Live" on a running retro — one word for two unrelated
                 concepts. Board state owns "Live"; the transport says "Synced". */}
          {board.status === 'ACTIVE' && (
            <Tooltip title={connected
              ? 'Synced — updates appear as they happen'
              : 'Reconnecting — the board refreshes every 5 seconds'}>
              <Chip
                size="small"
                variant="outlined"
                data-testid="live-indicator"
                icon={connected
                  ? <WifiTetheringRounded sx={{ fontSize: 15 }} />
                  : <SyncProblemRounded sx={{ fontSize: 15 }} />}
                label={connected ? 'Synced' : 'Reconnecting'}
                color={connected ? 'success' : 'default'}
              />
            </Tooltip>
          )}

          <Box sx={{ flexGrow: 1 }} />

          {/* Sharing a DRAFT link is a trap: the board is private until it is
              opened, so everyone the facilitator sends it to hits a 403. The
              button stays visible (so its absence is not itself confusing) but
              says why it cannot be used yet. */}
          <Tooltip title={board.status === 'DRAFT'
            ? 'Open the board to the team first — until then this link only works for you'
            : 'Copy the share link — only people with access to this project can open it'}>
            <span>
              <Button
                size="small" startIcon={<ContentCopyRounded />}
                data-testid="copy-link"
                disabled={board.status === 'DRAFT'}
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  setToast('Share link copied');
                }}
              >
                Share
              </Button>
            </span>
          </Tooltip>

          {board.permissions.canExportPdf && (
            <Button
              size="small" startIcon={<PictureAsPdfRounded />}
              disabled={wantPdf || pdf.generating}
              onClick={() => setWantPdf(true)}
              data-testid="export-pdf"
            >
              {wantPdf || pdf.generating ? 'Preparing…' : 'PDF'}
            </Button>
          )}

          {board.permissions.canEditSettings && (
            <Tooltip title="Board settings">
              <Button
                size="small" startIcon={<SettingsRounded />}
                onClick={() => setSettingsOpen(true)} data-testid="board-settings"
              >
                Settings
              </Button>
            </Tooltip>
          )}

          {board.permissions.canChangeStatus && board.status === 'DRAFT' && (
            <Button
              size="small" variant="contained" startIcon={<PlayArrowRounded />}
              onClick={() => advance('ACTIVE')} data-testid="publish-board"
            >
              Open to team
            </Button>
          )}
          {board.permissions.canChangeStatus && board.status === 'ACTIVE' && (
            <Button
              size="small" variant="contained" color="primary" startIcon={<CheckCircleRounded />}
              onClick={() => advance('COMPLETED')} data-testid="complete-board"
            >
              Complete retro
            </Button>
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {board.projectName ? `${board.projectName} · ` : ''}
          {board.meetingDate} at {board.meetingTime} · Facilitator: {board.facilitatorName ?? '—'}
          {presence.length > 0 && ` · ${presence.length} participant${presence.length === 1 ? '' : 's'}`}
        </Typography>

        {board.status === 'DRAFT' && board.isFacilitator && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            This board is still a draft — only you can see it. Open it to the team when you are ready.
          </Alert>
        )}
        {/* ARCHIVED is equally frozen and was previously left unexplained — a
            viewer saw a board with every control missing and no reason given. */}
        {(board.status === 'COMPLETED' || board.status === 'ARCHIVED') && (
          <Alert severity="info" sx={{ mt: 1.5 }} data-testid="frozen-notice">
            {board.status === 'ARCHIVED'
              ? 'This retro has been archived. It is kept as a read-only record.'
              : 'This retro is complete and the record is now read-only.'}
            {' '}Any action items or risks created from it carry on under their own lifecycle.
          </Alert>
        )}
        {board.votingEnabled && !readOnly && (
          <Typography
            variant="caption"
            color={overBudget ? 'warning.main' : 'text.secondary'}
            data-testid="vote-counter"
          >
            {board.votesPerUser === 0
              ? `You have used ${detail.myVotesUsed} votes (unlimited).`
              : overBudget
                // The limit was lowered after this person voted. Their votes are
                // kept — silently deleting them would be worse — so explain the
                // state rather than rendering "used 5 of 2".
                ? `You have used ${detail.myVotesUsed} votes, but the limit is now ${board.votesPerUser}. Remove ${detail.myVotesUsed - board.votesPerUser} to vote again.`
                : `You have used ${detail.myVotesUsed} of ${board.votesPerUser} votes.`}
          </Typography>
        )}
      </Paper>

      {/* What the last retro agreed, and what came of it. */}
      {carryForwardQuery.data && (
        <CarryForwardPanel
          data={carryForwardQuery.data}
          busy={setOutcome.isPending}
          onSetOutcome={async (itemId, outcome, note) => {
            try {
              await setOutcome.mutateAsync({ boardId: board.id, itemId, outcome, note });
              setToast('Outcome recorded');
            } catch (e) { showError(e, 'Could not record the outcome'); }
          }}
          onConvert={point => setConvertCarried(point)}
        />
      )}

      {/* Where voting turns into a decision. */}
      <TopPicksPanel
        board={board}
        items={detail.items}
        onSetRank={async (item, rank) => {
          try {
            await setTopPick.mutateAsync({ itemId: item.id, boardId: board.id, rank });
          } catch (e) { showError(e, 'Could not update the top 3'); }
        }}
        onApplyVoteSuggestion={async votes => {
          try {
            await updateBoard.mutateAsync({ boardId: board.id, data: { votesPerUser: votes } });
            setToast(`Everyone now has ${votes} votes`);
          } catch (e) { showError(e, 'Could not update the vote limit'); }
        }}
      />

      <Divider sx={{ mb: 2 }} />

      {/* Lanes */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', overflowX: 'auto', pb: 2 }}>
          {[...board.lanes].sort((a, b) => a.order - b.order).map(lane => (
            <RetroLane
              key={lane.key}
              lane={lane}
              items={itemsByLane.get(lane.key) ?? []}
              canAddItems={board.permissions.canAddItems}
              allowAnonymous={board.allowAnonymous}
              dragDisabled={readOnly}
              onAdd={handleAdd}
              onOpen={setOpenItem}
              onVote={handleVote}
              onDelete={handleRemoveBox}
            />
          ))}
        </Box>

        <DragOverlay>
          {activeItem && (
            <RetroItemCard
              item={activeItem}
              onOpen={() => {}}
              onVote={() => {}}
              onDelete={() => {}}
              dragDisabled
            />
          )}
        </DragOverlay>
      </DndContext>

      {openItem && (
        <RetroItemDetailModal
          item={detail.items.find(i => i.id === openItem.id) ?? openItem}
          board={board}
          onClose={() => setOpenItem(null)}
          onConvert={item => { setConvertItem(item); setOpenItem(null); }}
        />
      )}

      {convertItem && (
        <ConvertItemModal
          item={convertItem}
          board={board}
          onClose={() => setConvertItem(null)}
          onDone={msg => setToast(msg)}
        />
      )}

      {convertCarried && (
        <ConvertItemModal
          item={convertCarried}
          board={board}
          carried
          onClose={() => setConvertCarried(null)}
          onDone={msg => setToast(msg)}
        />
      )}

      {settingsOpen && (
        <BoardSettingsModal
          board={board}
          itemCount={detail.items.length}
          // Only this user's own spend is known client-side; it is the closest
          // honest signal for the "lowering below what someone spent" warning.
          maxVotesSpent={detail.myVotesUsed}
          onClose={() => setSettingsOpen(false)}
          onSaved={msg => setToast(msg)}
        />
      )}

      {wantPdf && summaryQuery.data && (
        <RetroPdfDocument summary={summaryQuery.data} targetRef={pdf.targetRef} />
      )}

      <ConfirmDeleteDialog
        open={isOpen}
        title="Delete message?"
        message="Are you sure you want to delete this message? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleRemove}
        onClose={() => setIsOpen(false)}
      />

      <Snackbar
        open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)}
        message={toast ?? ''} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)} data-testid="board-error">{error}</Alert>
      </Snackbar>
    </Container>
  );
}

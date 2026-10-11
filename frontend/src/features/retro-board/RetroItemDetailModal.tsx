import { useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControlLabel, IconButton, MenuItem, Select, Switch, TextField, Typography,
} from '@mui/material';
import { DeleteOutlineRounded, VisibilityOffRounded, EmojiEventsRounded } from '@mui/icons-material';
import {
  useRetroComments, useCreateRetroComment, useDeleteRetroComment, useUpdateRetroItem, useSetTopPick,
} from './hooks';
import type { RetroBoard, RetroItem } from './types';

interface Props {
  item: RetroItem | null;
  board: RetroBoard;
  onClose: () => void;
  onConvert: (item: RetroItem) => void;
}

export default function RetroItemDetailModal({ item, board, onClose, onConvert }: Props) {
  const [comment, setComment] = useState('');
  const [anonComment, setAnonComment] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commentsQuery = useRetroComments(item?.id);
  const createComment = useCreateRetroComment();
  const deleteComment = useDeleteRetroComment();
  const updateItem = useUpdateRetroItem();
  const setTopPick = useSetTopPick();

  if (!item) return null;

  const submitComment = async () => {
    if (!comment.trim()) return;
    setError(null);
    try {
      await createComment.mutateAsync({
        itemId: item.id, boardId: board.id,
        data: { comment: comment.trim(), isAnonymous: anonComment },
      });
      setComment('');
      setAnonComment(false);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to add comment');
    }
  };

  const saveEdit = async () => {
    setError(null);
    try {
      await updateItem.mutateAsync({ itemId: item.id, boardId: board.id, data: { content: draft.trim() } });
      setEditing(false);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save');
    }
  };

  const changeRank = async (rank: number | null) => {
    setError(null);
    try {
      await setTopPick.mutateAsync({ itemId: item.id, boardId: board.id, rank });
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to set rank');
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        Retro item
        {item.isAnonymous && (
          <Chip size="small" icon={<VisibilityOffRounded sx={{ fontSize: 14 }} />} label="Anonymous" variant="outlined" />
        )}
      </DialogTitle>

      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {editing ? (
          <>
            <TextField
              fullWidth multiline minRows={3} size="small"
              value={draft} onChange={e => setDraft(e.target.value)}
            />
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <Button size="small" variant="contained" onClick={saveEdit}>Save</Button>
              <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
            </Box>
          </>
        ) : (
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{item.content}</Typography>
        )}

        <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">
            {item.isAnonymous
              ? 'Posted anonymously'
              : `by ${item.author?.firstName ?? ''} ${item.author?.lastName ?? ''}`.trim()}
            {' · '}{item.voteCount} vote{item.voteCount === 1 ? '' : 's'}
          </Typography>

          {!editing && item.permissions.canEdit && (
            <Button size="small" onClick={() => { setDraft(item.content); setEditing(true); }}>
              Edit
            </Button>
          )}
        </Box>

        {item.isAnonymous && (
          <Alert severity="info" sx={{ mt: 1.5 }} data-testid="anon-explainer">
            Anonymous items can&apos;t be edited — we don&apos;t store who wrote them.
          </Alert>
        )}

        {item.converted && (
          <Alert severity="success" sx={{ mt: 1.5 }}>
            Converted to {item.converted.type === 'ACTION_ITEM' ? 'action item' : 'risk'} #{item.converted.refId}.
            It now follows its own lifecycle; this retro item stays as it was agreed.
          </Alert>
        )}

        {board.permissions.canMarkTopPicks && (
          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <EmojiEventsRounded fontSize="small" color="action" />
            <Typography variant="body2">Top 3 rank</Typography>
            {/* String-valued so the "not ranked" empty option stays a real
                member of the value type rather than an unreachable comparison. */}
            <Select
              size="small"
              value={item.topPickRank ? String(item.topPickRank) : ''}
              displayEmpty
              data-testid="top-pick-select"
              onChange={e => changeRank(e.target.value ? Number(e.target.value) : null)}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="">Not ranked</MenuItem>
              <MenuItem value="1">Top 1</MenuItem>
              <MenuItem value="2">Top 2</MenuItem>
              <MenuItem value="3">Top 3</MenuItem>
            </Select>
          </Box>
        )}

        {item.permissions.canConvert && !item.converted && (
          <Box sx={{ mt: 2 }}>
            <Button size="small" variant="outlined" data-testid="convert-btn" onClick={() => onConvert(item)}>
              Create action item or risk…
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Optional — only if you decide this needs tracked follow-up.
            </Typography>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Comments ({commentsQuery.data?.length ?? 0})
        </Typography>

        {commentsQuery.data?.map(c => (
          <Box key={c.id} sx={{ mb: 1.5, display: 'flex', gap: 1 }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{c.comment}</Typography>
              <Typography variant="caption" color="text.secondary">
                {c.isAnonymous ? 'Anonymous' : `${c.author?.firstName ?? ''} ${c.author?.lastName ?? ''}`.trim()}
                {c.editedAt ? ' · (edited)' : ''}
              </Typography>
            </Box>
            {c.canDelete && (
              <IconButton
                size="small"
                onClick={() => deleteComment.mutateAsync({ commentId: c.id, itemId: item.id, boardId: board.id })}
              >
                <DeleteOutlineRounded sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Box>
        ))}

        {commentsQuery.data?.length === 0 && (
          <Typography variant="caption" color="text.secondary">No comments yet.</Typography>
        )}

        {item.permissions.canComment && (
          <Box sx={{ mt: 2 }}>
            <TextField
              fullWidth multiline minRows={2} size="small" placeholder="Add a comment…"
              value={comment} onChange={e => setComment(e.target.value)}
              inputProps={{ 'data-testid': 'comment-input' }}
            />
            {board.allowAnonymous && (
              <FormControlLabel
                sx={{ mt: 0.5 }}
                control={<Switch size="small" checked={anonComment} onChange={e => setAnonComment(e.target.checked)} />}
                label={<Typography variant="caption">Comment anonymously</Typography>}
              />
            )}
            <Box>
              <Button
                size="small" variant="contained" sx={{ mt: 1 }}
                disabled={!comment.trim()} onClick={submitComment}
                data-testid="comment-submit"
              >
                Comment
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

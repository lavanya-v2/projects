/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Chip, Button, TextField, MenuItem,
  Divider, CircularProgress, Alert, IconButton, Tooltip, Avatar,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  useAddActionItemComment, useDeleteActionItemComment, useUpdateActionItemComment,
  useUpdateActionItem, useTransitionActionItemStatus,
  useAddProgramActionItemComment, useDeleteProgramActionItemComment, useUpdateProgramActionItemComment,
  useUpdateProgramActionItem, useTransitionProgramActionItemStatus,
} from './hooks';
import { useAuth } from '../../context/AuthContext';
import dayjs from 'dayjs';
import { DatePicker } from '@mui/x-date-pickers';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

// eslint-disable-next-line react-refresh/only-export-components
export const ACTION_ITEM_CATEGORIES = [
  'Task', 'Follow-up', 'Decision Required', 'Issue', 'Risk & Mitigation', 'Dependency',
];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  'Open': ['In-Progress', 'Closed', 'Discarded'],
  'In-Progress': ['Closed', 'Discarded'],
  'Closed': [],
  'Discarded': [],
};

const STATUS_COLORS: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  'Open': 'default',
  'In-Progress': 'warning',
  'Closed': 'success',
  'Discarded': 'error',
};

const CATEGORY_COLORS: Record<string, string> = {
  'Task': '#1565c0',
  'Follow-up': '#6a1b9a',
  'Decision Required': '#e65100',
  'Issue': '#c62828',
  'Risk & Mitigation': '#f57f17',
  'Dependency': '#2e7d32',
};

interface FormInput {
  title: string;
  category: string;
  owner: string;
  dueDate?: string;
}

const editSchema = z.object({
  title: z.string().min(1, { message: "Title is required" }),
  category: z.string().min(1, { message: "Category is required" }),
  owner: z.string().min(1, { message: "Owner is required" }),
  dueDate: z
    .string()
    .optional()
    .refine((value) => {
      if (!value) return true;
      const today = dayjs();
      const dueDate = dayjs(value);
      return dueDate.isAfter(today);
    }, {
      message: "Due date cannot be today or past date",
    })
    .refine((value) => {
      if (!value) return true;
      const today = dayjs();
      const maxDate = today.add(90, 'day');
      const dueDate = dayjs(value);
      return dueDate.isBefore(maxDate);
    }, {
      message: "Due date should be within 90 days from today",
    }),
});

interface Props {
  item: any;
  open: boolean;
  onClose: () => void;
  onUpdated: (updated: any) => void;
  readOnly?: boolean;
  /** Action-item scope. 'program' switches to program hooks and enables in-modal delete. */
  scope?: 'project' | 'program';
  /** When provided (program scope), shows a Delete button in the header for permitted users. */
  onDelete?: () => void;
}

export const ActionItemDetailModal = ({ item, open, onClose, onUpdated, readOnly = false, scope = 'project', onDelete }: Props) => {
  const { user } = useAuth();
  const isProgram = scope === 'program';
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
    control,
  } = useForm<FormInput>({
    values: {
      title: item.title ?? '',
      category: item.category ?? '',
      owner: item.owner ?? '',
      dueDate: item.dueDate ?? '',
    },
    resolver: zodResolver(editSchema),
  });

  // Both hook sets are instantiated (React requires unconditional calls); we pick by scope.
  const addProjectComment = useAddActionItemComment();
  const deleteProjectComment = useDeleteActionItemComment();
  const updateProjectComment = useUpdateActionItemComment();
  const updateProjectItem = useUpdateActionItem();
  const transitionProjectItem = useTransitionActionItemStatus();
  const addProgramComment = useAddProgramActionItemComment();
  const deleteProgramComment = useDeleteProgramActionItemComment();
  const updateProgramComment = useUpdateProgramActionItemComment();
  const updateProgramItem = useUpdateProgramActionItem();
  const transitionProgramItem = useTransitionProgramActionItemStatus();

  const addActionItemComment = isProgram ? addProgramComment : addProjectComment;
  const deleteActionItemComment = isProgram ? deleteProgramComment : deleteProjectComment;
  const updateActionItemComment = isProgram ? updateProgramComment : updateProjectComment;
  const updateActionItem = isProgram ? updateProgramItem : updateProjectItem;
  const transitionActionItemStatus = isProgram ? transitionProgramItem : transitionProjectItem;

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState('');
  const [transitionNote, setTransitionNote] = useState('');
  const [transitionError, setTransitionError] = useState('');

  // Comments
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');

  // Only the newest comment in the thread is editable (and only by its author).
  const comments: any[] = item?.comments ?? [];
  const lastCommentId: number | null = comments.length ? comments[comments.length - 1].id : null;

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    setCommentError('');
    try {
      const comment = await addActionItemComment.mutateAsync({ itemId: item.id, content: commentText.trim() });
      setCommentText('');
      // Merge new comment into item
      onUpdated({ ...item, comments: [...(item.comments ?? []), comment] });
    } catch {
      setCommentError('Failed to add comment.');
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    setDeletingCommentId(commentId);
    try {
      await deleteActionItemComment.mutateAsync(commentId);
      onUpdated({ ...item, comments: (item.comments ?? []).filter((c: any) => c.id !== commentId) });
    } catch {
      setCommentError('Failed to delete comment.');
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleStartEditComment = (c: any) => {
    setCommentError('');
    setEditingCommentId(c.id);
    setEditingCommentText(c.content);
  };

  const handleCancelEditComment = () => {
    setEditingCommentId(null);
    setEditingCommentText('');
  };

  const handleSaveEditComment = async () => {
    if (editingCommentId == null || !editingCommentText.trim()) return;
    setCommentError('');
    try {
      const updated = await updateActionItemComment.mutateAsync({ commentId: editingCommentId, content: editingCommentText.trim() });
      onUpdated({ ...item, comments: (item.comments ?? []).map((c: any) => (c.id === editingCommentId ? updated : c)) });
      setEditingCommentId(null);
      setEditingCommentText('');
    } catch {
      setCommentError('Failed to update comment. Only your latest comment can be edited.');
    }
  };

  const handleStartEdit = () => {
    setEditError('');
    setIsEditing(true);
  };

  const handleSaveEdit = async (data: FormInput) => {
    try {
      const updated = await updateActionItem.mutateAsync({
        id: item.id,
        data: {
          title: data.title.trim(),
          category: data.category,
          owner: data.owner.trim(),
          dueDate: data.dueDate || null,
        },
      });
      onUpdated(updated);
      setIsEditing(false);
    } catch {
      setEditError('Failed to save changes.');
    }
  };

  const handleOpenTransition = (status: string) => {
    setTargetStatus(status);
    setTransitionNote('');
    setTransitionError('');
    setTransitionOpen(true);
  };

  const handleConfirmTransition = async () => {
    setTransitionError('');
    try {
      const updated = await transitionActionItemStatus.mutateAsync({ id: item.id, toStatus: targetStatus, note: transitionNote || undefined });
      onUpdated(updated);
      setTransitionOpen(false);
    } catch (err) {
      const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
      setTransitionError(errorWithResponse?.response?.data?.error || 'Failed to update status.');
    }
  };

  const handleOnClose = () => {
    setIsEditing(false);
    setEditError('');
    onClose();
  }

  const isSuperuser = user?.role === 'SUPERUSER' || user?.roleName === 'superuser';
  const isAdmin = user?.roleName === 'admin';
  const isManager = user?.roleName === 'manager';
  const isLead = user?.roleName === 'lead';
  const isOwnItem = item?.createdById === user?.id;
  const isTerminal = item?.status === 'Closed' || item?.status === 'Discarded';
  // Program scope: anyone with program access may create/read/update (access is gated server-side).
  // Project scope: keep the existing role-based rules.
  const canCloseOrDiscard = isProgram || isSuperuser || isAdmin || isManager || (isLead && isOwnItem);
  const canEdit = !isTerminal && (isProgram || isSuperuser || isAdmin || isManager || (isLead && isOwnItem));
  // Program delete is restricted to the creator, admins, and superusers.
  const canDelete = isProgram && !!onDelete && (isSuperuser || isAdmin || isOwnItem);
  const allNextStatuses = ALLOWED_TRANSITIONS[item?.status] ?? [];
  const nextStatuses = allNextStatuses.filter(s =>
    (s !== 'Closed' && s !== 'Discarded') || canCloseOrDiscard
  );
  const creatorName = item?.createdBy
    ? `${item.createdBy.firstName ?? ''} ${item.createdBy.lastName ?? ''}`.trim()
    : null;

  return (
    <>
      <Dialog open={open} onClose={handleOnClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, pr: 1 }}>
            <Typography color="text.primary" variant="h5" sx={{ mb: 1.5 }}>{isEditing ? 'Edit Action Item' : 'Action Item Details'}</Typography>
          </Box>
        </DialogTitle>

        <DialogContent dividers>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
            <Box sx={{ flex: 1, pr: 1 }}>
              {isEditing ? (
                <TextField fullWidth size="small" label="Title*" variant="outlined"
                  placeholder="Action item title" autoFocus
                  {...register("title")}
                  error={!!errors.title}
                  helperText={errors.title?.message || ""}
                />) : (
                <Typography variant="h6" sx={{ lineHeight: 0.1 }}>{item?.title}</Typography>
              )}
            </Box>

            <Box sx={{ gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
              {canEdit && !isEditing && (
                <Tooltip title="Edit"><IconButton size="small" onClick={handleStartEdit}><EditIcon fontSize="small" /></IconButton></Tooltip>
              )}
              {canDelete && !isEditing && (
                <Tooltip title="Delete"><IconButton size="small" color="error" onClick={onDelete}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
              )}
              <IconButton size="medium" onClick={handleOnClose}><CloseIcon fontSize="small" /></IconButton>
            </Box>
          </Box>

          {editError && <Alert severity="error" sx={{ mb: 2 }}>{editError}</Alert>}

          {/* Meta row */}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
            {isEditing ? (
              <>
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      size="small"
                      label="Category *"
                      sx={{ minWidth: 180 }}
                    >
                      {ACTION_ITEM_CATEGORIES.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                <TextField size="small" label="Owner *" sx={{ minWidth: 160 }}
                  {...register("owner")}
                  error={!!errors.owner}
                  helperText={errors.owner?.message || ""}
                />
                <Controller
                  name="dueDate"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      label="Due Date"
                      value={field.value ? dayjs(field.value) : null}
                      onChange={(date) => {
                        field.onChange(
                          date ? date.format('YYYY-MM-DD') : ''
                        );
                      }}
                      slotProps={{
                        textField: {
                          size: 'small',
                          error: !!errors.dueDate,
                          helperText: errors.dueDate?.message,
                        }
                      }}
                      minDate={dayjs()}
                      maxDate={dayjs().add(90, 'day')}
                      sx={{ minWidth: 160 }}
                    />
                  )}
                />
              </>
            ) : (
              <>
                <Chip
                  label={item?.category}
                  size="small"
                  sx={{ bgcolor: CATEGORY_COLORS[item?.category] ?? '#455a64', color: '#fff', fontWeight: 600 }}
                />
                <Chip label={item?.status} size="small" color={STATUS_COLORS[item?.status]} />
                <Typography variant="body2" color="text.secondary">
                  <b>Owner:</b> {item?.owner}
                </Typography>
                {item?.dueDate && (
                  <Typography variant="body2" color="text.secondary">
                    <b>Due:</b> {dayjs(item.dueDate).format('MMM D, YYYY')}
                  </Typography>
                )}
                {creatorName && (
                  <Typography variant="body2" color="text.secondary">
                    <b>Created by:</b> {creatorName}
                  </Typography>
                )}
              </>
            )}
          </Box>

          {/* Transition buttons */}
          {nextStatuses.length > 0 && !isEditing && (
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              {nextStatuses.map(s => (
                <Button key={s} size="small" variant="outlined" startIcon={<ArrowForwardIcon />}
                  onClick={() => handleOpenTransition(s)}
                  color={s === 'Closed' ? 'success' : s === 'Discarded' ? 'error' : 'primary'}>
                  {s === 'Discarded' ? 'Discard' : `Move to ${s}`}
                </Button>
              ))}
            </Box>
          )}

          {/* Status History */}
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" gutterBottom>Status History</Typography>
          {(!item?.statusHistory || item.statusHistory.length === 0) ? (
            <Typography variant="body2" color="text.secondary">No history yet.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {item.statusHistory.map((h: any) => (
                <Box key={h.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  <Box sx={{ pt: 0.3, flexShrink: 0 }}>
                    {h.fromStatus ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Chip label={h.fromStatus} size="small" color={STATUS_COLORS[h.fromStatus]} sx={{ fontSize: 11 }} />
                        <ArrowForwardIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                        <Chip label={h.toStatus} size="small" color={STATUS_COLORS[h.toStatus]} sx={{ fontSize: 11 }} />
                      </Box>
                    ) : (
                      <Chip label="Created" size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    )}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    {h.note && <Typography variant="body2">{h.note}</Typography>}
                    <Typography variant="caption" color="text.secondary">
                      {dayjs(h.changedAt).format('MMM D, YYYY h:mm A')}
                      {h.changedBy && ` · ${h.changedBy.firstName} ${h.changedBy.lastName}`}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {/* Comments */}
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" gutterBottom>Comments</Typography>
          {commentError && <Alert severity="error" sx={{ mb: 1.5, py: 0.5 }}>{commentError}</Alert>}

          {(!item?.comments || item.comments.length === 0) ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>No comments yet.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
              {item.comments.map((c: any) => {
                const initials = `${c.user?.firstName?.[0] ?? ''}${c.user?.lastName?.[0] ?? ''}`.toUpperCase() || '?';
                const isOwn = c.userId === (user as any)?.id;
                // Author may edit only the latest comment in the thread.
                const canEdit = isOwn && c.id === lastCommentId && !readOnly;
                const isEditingThis = editingCommentId === c.id;
                return (
                  <Box key={c.id} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                    <Avatar sx={{ width: 28, height: 28, fontSize: 11, fontWeight: 700, bgcolor: 'primary.main', flexShrink: 0 }}>
                      {initials}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                          {c.user ? `${c.user.firstName} ${c.user.lastName}` : 'Unknown'}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                          {dayjs(c.createdAt).format('MMM D, YYYY h:mm A')}
                        </Typography>
                        {c.editedAt && (
                          <Tooltip title={`Edited ${dayjs(c.editedAt).format('MMM D, YYYY h:mm A')}`}>
                            <Typography sx={{ fontSize: 11, fontStyle: 'italic', color: '#94a3b8' }}>(edited)</Typography>
                          </Tooltip>
                        )}
                      </Box>
                      {isEditingThis ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 0.5 }}>
                          <TextField
                            size="small" fullWidth multiline rows={2} autoFocus
                            value={editingCommentText}
                            onChange={e => setEditingCommentText(e.target.value)}
                            disabled={updateActionItemComment.isPending}
                            sx={{ '& .MuiInputBase-root': { fontSize: 13 } }}
                          />
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button size="small" variant="contained"
                              onClick={handleSaveEditComment}
                              disabled={!editingCommentText.trim() || updateActionItemComment.isPending}
                              startIcon={updateActionItemComment.isPending ? <CircularProgress size={12} color="inherit" /> : undefined}>
                              Save
                            </Button>
                            <Button size="small" onClick={handleCancelEditComment} disabled={updateActionItemComment.isPending}>Cancel</Button>
                          </Box>
                        </Box>
                      ) : (
                        <Typography sx={{ fontSize: 13, color: '#374151', lineHeight: 1.5, wordBreak: 'break-word' }}>
                          {c.content}
                        </Typography>
                      )}
                    </Box>
                    {!isEditingThis && (
                      <Box sx={{ display: 'flex', flexShrink: 0 }}>
                        {canEdit && (
                          <Tooltip title="Edit comment">
                            <IconButton size="small" onClick={() => handleStartEditComment(c)} sx={{ mt: -0.5 }}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {(isOwn || isSuperuser || (isProgram && isAdmin)) && !readOnly && (
                          <Tooltip title="Delete comment">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDeleteComment(c.id)}
                              disabled={deletingCommentId === c.id}
                              sx={{ mt: -0.5 }}
                            >
                              {deletingCommentId === c.id
                                ? <CircularProgress size={14} />
                                : <DeleteOutlineIcon fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}

          {!isTerminal && <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              multiline
              rows={2}
              placeholder="Add a comment..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              disabled={addActionItemComment.isPending}
              sx={{ '& .MuiInputBase-root': { fontSize: 13 } }}
            />
            <Button
              variant="contained"
              size="small"
              onClick={handleAddComment}
              disabled={!commentText.trim() || addActionItemComment.isPending}
              sx={{ alignSelf: 'flex-end', minWidth: 64 }}
              startIcon={addActionItemComment.isPending ? <CircularProgress size={12} color="inherit" /> : undefined}
            >
              Post
            </Button>
          </Box>}
        </DialogContent>

        {isEditing && (
          <DialogActions>
            <Button onClick={() => { setIsEditing(false); setEditError('') }} disabled={updateActionItem.isPending}>Cancel</Button>
            <Button variant="contained" onClick={handleSubmit(handleSaveEdit)} disabled={updateActionItem.isPending || Object.keys(errors).length > 0}
              startIcon={updateActionItem.isPending ? <CircularProgress size={14} /> : <SaveIcon />}>
              Save
            </Button>
          </DialogActions>
        )}
      </Dialog>

      {/* Status transition dialog */}
      <Dialog open={transitionOpen} onClose={() => setTransitionOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Move to "{targetStatus}"</DialogTitle>
        <DialogContent>
          {transitionError && <Alert severity="error" sx={{ mb: 2 }}>{transitionError}</Alert>}
          <TextField
            multiline minRows={3} fullWidth variant="outlined"
            label={targetStatus === 'Closed' || targetStatus === 'Discarded' ? `${targetStatus === 'Closed' ? 'Closing' : 'Discard'} comment (required)` : 'Note (optional)'}
            placeholder="What changed? Any context or update…"
            value={transitionNote}
            onChange={e => setTransitionNote(e.target.value)}
            required={targetStatus === 'Closed' || targetStatus === 'Discarded'}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransitionOpen(false)} disabled={transitionActionItemStatus.isPending}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirmTransition}
            disabled={transitionActionItemStatus.isPending || ((targetStatus === 'Closed' || targetStatus === 'Discarded') && !transitionNote.trim())}
            color={targetStatus === 'Closed' ? 'success' : targetStatus === 'Discarded' ? 'error' : 'primary'}
            startIcon={transitionActionItemStatus.isPending ? <CircularProgress size={14} /> : <ArrowForwardIcon />}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

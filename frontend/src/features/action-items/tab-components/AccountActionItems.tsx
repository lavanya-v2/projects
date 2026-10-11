import { useState, useEffect } from 'react';
import {
  Box, Paper, Typography, Button, TextField, MenuItem,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, Divider, Avatar,
  CircularProgress, Alert, IconButton, Tooltip
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useAuth } from '../../../context/AuthContext';
import { ACTION_ITEM_CATEGORIES } from '../ActionItemDetailModal';
import {
  useAccountActionItem,
  useMyAccountActionItems,
  useCreateAccountActionItem,
  useDeleteAccountActionItem,
  useTransitionAccountActionItemStatus,
  useUpdateAccountActionItem,
  useAddAccountActionItemComment,
  useDeleteAccountActionItemComment,
  useUpdateAccountActionItemComment,
} from '../hooks';
import dayjs from 'dayjs';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import type { Account } from '../../admin/accounts/types';
import type { ActionItemComment } from '../../../types';
import { ALLOWED_TRANSITIONS, type ActionItemType, type PaginatedResponse, type SortConfig } from '../types';
import { FilterChips } from '../ActionItemsPage';
import { CATEGORY_COLORS, STATUS_COLORS } from '../../../theme/tokens';
import ConfirmationDialog from '../../../shared/components/ConfirmationDialog';
import { CreateActionItemForm } from '../CreateActionItemForm';
import type { ActionItemFormValues, ActionItemTab } from '../schema';
import ActionItemTable from '../ActionItemTable';
import ActionItemFilters from '../ActionItemFilters';
import { ActionItemHeader } from '../ActionItemHeader';

interface Props {
  accounts: Account[];
  selectedAccount?: Account | null;
  activeTab: ActionItemTab;
}

export const AccountActionItems = ({ accounts, selectedAccount: propAccount, activeTab }: Props) => {
  const [page, setPage] = useState(1);
  const limit = 10;
  const { user } = useAuth();
  const isLead = user?.roleName === 'lead';
  const isSuperuser = user?.role === 'SUPERUSER' || user?.roleName === 'superuser';
  const isAdmin = user?.roleName === 'admin';
  const isManager = user?.roleName === 'manager';

  const [selectedAccount, setSelectedAccount] = useState<string>(propAccount?.id ? String(propAccount.id) : 'all');
  const [searchFilter, setSearchFilter] = useState("");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [acctError, setAcctError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  // Applied: changed only when Apply or Clear is clicked
  const [appliedFilters, setAppliedFilters] = useState({
    status: [] as string[],
    category: [] as string[],
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [accountSortConfig, setAccountSortConfig] = useState<SortConfig | undefined>();

  // Account Action Items state
  const [selectedAcctDetailId, setSelectedAcctDetailId] = useState<number | null>(null);
  const [acctDetailItem, setAcctDetailItem] = useState<ActionItemType | null>(null);
  const [acctDetailOpen, setAcctDetailOpen] = useState(false);
  const [acctCreateOpen, setAcctCreateOpen] = useState(false);
  const [acctDeleteId, setAcctDeleteId] = useState<number | null>(null);
  const [acctTransitionOpen, setAcctTransitionOpen] = useState(false);
  const [acctTransitionItem, setAcctTransitionItem] = useState<ActionItemType | null>(null);
  const [acctTargetStatus, setAcctTargetStatus] = useState('');
  const [acctTransitionNote, setAcctTransitionNote] = useState('');
  // Account item edit mode
  const [acctEditing, setAcctEditing] = useState(false);
  const [acctEditData, setAcctEditData] = useState({ title: '', category: '', owner: '', dueDate: '' });
  const [acctEditError, setAcctEditError] = useState('');
  // Account item comments
  const [acctCommentText, setAcctCommentText] = useState('');
  const [acctDeletingCommentId, setAcctDeletingCommentId] = useState<number | null>(null);
  const [acctEditingCommentId, setAcctEditingCommentId] = useState<number | null>(null);
  const [acctEditingCommentText, setAcctEditingCommentText] = useState('');

  // Sync global account selection
  useEffect(() => {
    if (propAccount?.id) {
      setSelectedAccount(String(propAccount.id));
      setSearchFilter('');
      setPage(1);
    }
  }, [propAccount?.id]);

  const handleSearch = (value: string) => {
    setPage(1);
    setSearchFilter(value);
  };

  const handleClear = () => {
    setPage(1);
    setSearchFilter('');
  };

  //Account Filter handler
  const handleAccountFilters = () => {
    setAnchorEl(null);
    setPage(1);
    setAppliedFilters({
      ...appliedFilters,
      status: statusFilter,
      category: categoryFilter
    });
  };

  const handleAccountClearFilters = () => {
    setStatusFilter([]);
    setCategoryFilter([]);
    setAppliedFilters({
      status: [],
      category: [],
    });
    setIsExpanded(false);
    setAnchorEl(null);
    setPage(1);
  };

  const handleAccountClearFilter = (type: string, value: string) => {
    if (type === 'status') {
      setStatusFilter(prevValue => prevValue.filter(statusName => statusName !== value))
      setAppliedFilters((prev) => ({
        ...prev, status: prev.status.filter((item) => item !== value),
      }));
    }
    if (type === "category") {
      setCategoryFilter((prevValue) => prevValue.filter((statusName) => statusName !== value));
      setAppliedFilters((prev) => ({
        ...prev, category: prev.category.filter((item) => item !== value),
      }));
    }
  };

  const handleSortRequest = (columnName: "status" | "category" | "dueDate") => {
    const getNextConfig = (currentConfig: SortConfig | undefined): SortConfig => {
      const isCurrentDesc = currentConfig?.column === columnName && currentConfig?.direction === 'DESC';
      return {
        column: columnName,
        direction: isCurrentDesc ? 'ASC' : 'DESC' as const
      };
    };
    setAccountSortConfig(getNextConfig(accountSortConfig));
    setPage(1);
  };

  const { data: allAcctItems = [], isLoading: acctLoading, isError: acctItemsError } = useMyAccountActionItems(
    propAccount?.id ? (propAccount.id as number) : 0,
    activeTab === 'account-items',
    appliedFilters.status.length > 0 ? appliedFilters.status : undefined,
    accountSortConfig,
    searchFilter.trim() === '' ? undefined : searchFilter,
    appliedFilters.category.length > 0 ? appliedFilters.category : undefined,
    page,
    limit
  );

  const allAccountItems = allAcctItems as unknown as PaginatedResponse<ActionItemType>;
  const accountList = allAccountItems?.data ?? [];
  const totalAcctItems: number = allAccountItems?.totalItems ?? 0;

  // Detail item fetch via hook (account)
  const { data: fetchedAcctDetailItem } = useAccountActionItem(selectedAcctDetailId);
  useEffect(() => {
    if (fetchedAcctDetailItem) {
      setAcctDetailItem(fetchedAcctDetailItem);
      setAcctDetailOpen(true);
    }
  }, [fetchedAcctDetailItem]);

  useEffect(() => {
    handleAccountClearFilters();
  }, [selectedAccount]);

  // Mutations
  const createAccountActionItem = useCreateAccountActionItem();
  const deleteAccountActionItem = useDeleteAccountActionItem();
  const transitionAccountActionItemStatus = useTransitionAccountActionItemStatus();
  const updateAccountActionItem = useUpdateAccountActionItem();
  const addAccountActionItemComment = useAddAccountActionItemComment();
  const deleteAccountActionItemComment = useDeleteAccountActionItemComment();
  const updateAccountActionItemComment = useUpdateAccountActionItemComment();

  // Open the project create dialog. Pre-fills account/project from the listing
  // filter when the user already has a specific one chosen — purely a convenience.
  // The form does NOT depend on the filter state.

  const handleOpenAcctCreateDialog = () => {
    setAcctCreateOpen(true);
  };

  const hasAppliedFilters = (appliedFilters.status && appliedFilters.status.length > 0) || (appliedFilters.category && appliedFilters.category.length > 0);
  const sameValues = (a: string[], b: string[]) =>
    a.length === b.length &&
    a.every((value) => b.includes(value));

  const hasFilterChanges = !sameValues(statusFilter, appliedFilters.status) || !sameValues(categoryFilter, appliedFilters.category);

  const acctActiveFilters = [
    ...appliedFilters.status.map((status) => ({ type: 'status', label: status })),
    ...appliedFilters.category.map((category) => ({ type: 'category', label: category }))
  ];
  const accountVisibleFilters = isExpanded ? acctActiveFilters : acctActiveFilters.slice(0, 5);
  const accountRemainingCount = acctActiveFilters.length - 5;

  const handleAcctCreate = async (data: ActionItemFormValues) => {
    if (data.tab !== "account-items") return;

    await createAccountActionItem.mutateAsync({
      accountId: Number(data.accountId),
      data: {
        title: data.title,
        category: data.category,
        owner: data.owner,
        dueDate: data.dueDate || null,
      },
    });

    setAcctCreateOpen(false);
  };

  const handleAcctDelete = async () => {
    if (!acctDeleteId) return;
    try {
      await deleteAccountActionItem.mutateAsync(acctDeleteId);
      setAcctDeleteId(null);
    } catch {
      setAcctError('Failed to delete account action item.');
    }
  };

  const handleAcctOpenDetail = (item: ActionItemType) => {
    setSelectedAcctDetailId(item.id);
  };

  const handleAcctTransition = async () => {
    if (!acctTransitionItem || !acctTargetStatus) return;
    try {
      await transitionAccountActionItemStatus.mutateAsync({
        id: acctTransitionItem.id,
        toStatus: acctTargetStatus,
        note: acctTransitionNote || undefined,
      });
      setAcctTransitionOpen(false);
      // Refresh detail item after transition
      setSelectedAcctDetailId(null);
      setTimeout(() => setSelectedAcctDetailId(acctTransitionItem.id), 50);
    } catch {
      setAcctError('Failed to update status.');
    }
  };

  const handleAcctStartEdit = () => {
    if (!acctDetailItem) return;
    setAcctEditData({ title: acctDetailItem.title, category: acctDetailItem.category, owner: acctDetailItem.owner, dueDate: acctDetailItem.dueDate ?? '' });
    setAcctEditError('');
    setAcctEditing(true);
  };

  const handleAcctSaveEdit = async () => {
    if (!acctDetailItem) return;
    if (!acctEditData.title.trim()) { setAcctEditError('Title is required.'); return; }
    if (!acctEditData.category.trim()) { setAcctEditError('Category is required.'); return; }
    if (!acctEditData.owner.trim()) { setAcctEditError('Owner is required.'); return; }
    if (acctEditData.dueDate && dayjs(acctEditData.dueDate).isAfter(dayjs().add(3, 'month'))) {
      setAcctEditError('Due date should be within 3 months'); return;
    }
    if (acctEditData.dueDate && dayjs(acctEditData.dueDate).isBefore(dayjs().subtract(1, 'day'))) {
      setAcctEditError('Due date cannot be past date'); return;
    }
    setAcctEditError('');
    try {
      const updated = await updateAccountActionItem.mutateAsync({
        id: acctDetailItem.id, data: {
          title: acctEditData.title.trim(),
          category: acctEditData.category,
          owner: acctEditData.owner.trim(),
          dueDate: acctEditData.dueDate || null,
        }
      });
      setAcctDetailItem(updated);
      setAcctEditing(false);
    } catch (err) {
      const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
      setAcctEditError(errorWithResponse?.response?.data?.error ?? 'Failed to save.');
    }
  };

  const handleAcctOnClose = () => {
    setAcctDetailOpen(false);
    setAcctEditing(false);
    setAcctEditError('');
    setSelectedAcctDetailId(null);
  };

  const handleAcctAddComment = async () => {
    if (!acctDetailItem || !acctCommentText.trim()) return;
    try {
      const comment = await addAccountActionItemComment.mutateAsync({ itemId: acctDetailItem.id, content: acctCommentText.trim() });
      setAcctCommentText('');
      setAcctDetailItem({ ...acctDetailItem, comments: [...(acctDetailItem.comments ?? []), comment] });
    } catch { /* non-fatal */ }
  };

  const handleAcctDeleteComment = async (commentId: number) => {
    setAcctDeletingCommentId(commentId);
    try {
      await deleteAccountActionItemComment.mutateAsync(commentId);
      if (acctDetailItem) {
        setAcctDetailItem({ ...acctDetailItem, comments: (acctDetailItem.comments ?? []).filter((c) => c.id !== commentId) });
      }
    } catch { /* non-fatal */ }
    finally { setAcctDeletingCommentId(null); }
  };

  const handleAcctStartEditComment = (c: ActionItemComment) => {
    setAcctEditingCommentId(c.id);
    setAcctEditingCommentText(c.content);
  };

  const handleAcctCancelEditComment = () => {
    setAcctEditingCommentId(null);
    setAcctEditingCommentText('');
  };

  const handleAcctSaveEditComment = async () => {
    if (acctEditingCommentId == null || !acctEditingCommentText.trim()) return;
    try {
      const updated = await updateAccountActionItemComment.mutateAsync({ commentId: acctEditingCommentId, content: acctEditingCommentText.trim() });
      setAcctDetailItem((prev) => prev ? { ...prev, comments: (prev.comments ?? []).map((c: ActionItemComment) => (c.id === acctEditingCommentId ? updated : c)) } : prev);
      setAcctEditingCommentId(null);
      setAcctEditingCommentText('');
    } catch { /* non-fatal */ }
  };

  const formatDueDate = (dateValue: string | null | undefined) => {
    return dateValue ? dayjs(dateValue) : null;
  };

  const handleDateChange = (newDueDate: dayjs.Dayjs | null) => {
    const setDueDate = newDueDate ? newDueDate.toISOString() : ''
    setAcctEditData(d => ({
      ...d,
      dueDate: setDueDate
    }));
  };

  const handleTransition = (item: ActionItemType) => {
    setAcctTransitionItem(item);
    setAcctTargetStatus(ALLOWED_TRANSITIONS[item.status][0]);
    setAcctTransitionNote('');
    setAcctTransitionOpen(true);
  };

  return (
    <Box>
      {/* Account Items Tab — superuser/admin only */}

      <Paper sx={{ mb: 4, overflow: 'hidden' }}>
        <ActionItemHeader tabName="Account" isLead={isLead} handleOpenCreateDialog={handleOpenAcctCreateDialog} />

        <Box sx={{ p: 3 }}>
          {(acctError || acctItemsError) && <Alert severity="error" sx={{ mb: 2 }}>{acctError || 'Failed to load account action items.'}</Alert>}

          {/* selector */}
          <ActionItemFilters
            onSearch={handleSearch}
            onClearSearch={handleClear}
            open={Boolean(anchorEl)}
            anchorEl={anchorEl}
            onPopoverOpen={(e) => setAnchorEl(e.currentTarget)}
            onPopoverClose={() => setAnchorEl(null)}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            categoryFilter={categoryFilter}
            onCategoryChange={setCategoryFilter}
            activeFilters={hasAppliedFilters}
            onApply={handleAccountFilters}
            onClear={handleAccountClearFilters}
            hasFilterChanges={hasFilterChanges}
          />

          {hasAppliedFilters &&
            <FilterChips
              visibleFilters={accountVisibleFilters}
              isExpanded={isExpanded}
              activeFilters={acctActiveFilters}
              remainingCount={accountRemainingCount}
              onClick={(type: string, value: string) => handleAccountClearFilter(type, value)}
              onClear={handleAccountClearFilters}
              onClickExpanded={(val) => setIsExpanded(val)} />
          }

          {acctLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : (
            <ActionItemTable
              items={accountList}
              totalItems={totalAcctItems}
              page={page}
              limit={limit}
              tab="account-items"
              relatedColumnLabel="Account"
              sortConfig={accountSortConfig}
              onSortRequest={handleSortRequest}
              onPageChange={setPage}
              userId={user?.id}
              userRole={user?.roleName || ""}
              isSuperuser={isSuperuser}
              isAdmin={isAdmin}
              isManager={isManager}
              isLead={isLead}
              onOpenDetail={handleAcctOpenDetail}
              handleTransitionClick={handleTransition}
            />
          )}
        </Box>
      </Paper>

      {/* Account Item Detail Dialog */}
      {acctDetailItem && (() => {
        const acctIsTerminal = ['Closed', 'Discarded'].includes(acctDetailItem.status);
        const acctIsOwnItem = acctDetailItem.createdById === user?.id;
        const acctCanEdit = !acctIsTerminal && (isSuperuser || (isAdmin && acctIsOwnItem));
        const acctCanCloseDiscard = isSuperuser || (isAdmin && acctIsOwnItem);
        const acctNextStatuses = (ALLOWED_TRANSITIONS[acctDetailItem.status] ?? []).filter(
          (s: string) => (s !== 'Closed' && s !== 'Discarded') || acctCanCloseDiscard
        );
        const acctCreatorName = acctDetailItem.createdBy
          ? `${acctDetailItem.createdBy.firstName ?? ''} ${acctDetailItem.createdBy.lastName ?? ''}`.trim()
          : null;
        return (
          <Dialog open={acctDetailOpen} onClose={handleAcctOnClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1, pr: 1 }}>
                {acctEditing ? (
                  <TextField fullWidth size="small" label="Title*" value={acctEditData.title} variant="outlined"
                    placeholder="Action item title" autoFocus
                    onChange={e => { setAcctEditData(d => ({ ...d, title: e.target.value })); setAcctEditError('') }} />
                ) : (
                  <Typography variant="h6" sx={{ lineHeight: 1.3 }}>{acctDetailItem.title}</Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                {acctCanEdit && !acctEditing && (
                  <Tooltip title="Edit"><IconButton size="small" onClick={handleAcctStartEdit}><EditIcon fontSize="small" /></IconButton></Tooltip>
                )}
                <IconButton size="small" onClick={handleAcctOnClose}><CloseIcon fontSize="small" /></IconButton>
              </Box>
            </DialogTitle>
            <DialogContent dividers>
              {acctEditError && <Alert severity="error" sx={{ mb: 2 }}>{acctEditError}</Alert>}
              {/* Meta row */}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
                {acctEditing ? (
                  <>
                    <TextField select size="small" label="Category *" value={acctEditData.category} sx={{ minWidth: 180 }}
                      onChange={e => setAcctEditData(d => ({ ...d, category: e.target.value }))}>
                      {ACTION_ITEM_CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </TextField>
                    <TextField size="small" label="Owner *" value={acctEditData.owner} sx={{ minWidth: 160 }}
                      onChange={e => { setAcctEditData(d => ({ ...d, owner: e.target.value })); setAcctEditError('') }} />
                    <LocalizationProvider dateAdapter={AdapterDayjs}>
                      <DatePicker
                        label="Due Date"
                        value={formatDueDate(acctEditData.dueDate)}
                        onChange={(date) => handleDateChange(date)}
                        views={['year', 'month', 'day']}
                        slotProps={{ textField: { size: 'small' } }}
                        sx={{ minWidth: 160 }} />
                    </LocalizationProvider>
                  </>
                ) : (
                  <>
                    <Chip label={acctDetailItem.category} size="small"
                      sx={{ bgcolor: CATEGORY_COLORS[acctDetailItem.category] ?? '#455a64', color: '#fff', fontWeight: 600 }} />
                    <Chip label={acctDetailItem.status} size="small" color={STATUS_COLORS[acctDetailItem.status]} />
                    <Typography variant="body2" color="text.secondary"><b>Owner:</b> {acctDetailItem.owner}</Typography>
                    {acctDetailItem.dueDate && (
                      <Typography variant="body2" color="text.secondary"><b>Due:</b> {dayjs(acctDetailItem.dueDate).format('MMM D, YYYY')}</Typography>
                    )}
                    {acctCreatorName && (
                      <Typography variant="body2" color="text.secondary"><b>Created by:</b> {acctCreatorName}</Typography>
                    )}
                  </>
                )}
              </Box>

              {/* Transition buttons */}
              {acctNextStatuses.length > 0 && !acctEditing && (
                <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                  {acctNextStatuses.map((s: string) => (
                    <Button key={s} size="small" variant="outlined" startIcon={<ArrowForwardIcon />}
                      onClick={() => { setAcctTransitionItem(acctDetailItem); setAcctTargetStatus(s); setAcctTransitionNote(''); setAcctTransitionOpen(true); }}
                      color={s === 'Closed' ? 'success' : s === 'Discarded' ? 'error' : 'primary'}>
                      {s === 'Discarded' ? 'Discard' : `Move to ${s}`}
                    </Button>
                  ))}
                </Box>
              )}

              {/* Status History */}
              {acctDetailItem.statusHistory?.length > 0 && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>Status History</Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                    {acctDetailItem.statusHistory.map((h) => (
                      <Box key={h.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                        <Box sx={{ pt: 0.3, flexShrink: 0 }}>
                          {h.fromStatus
                            ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Chip label={h.fromStatus} size="small" color={STATUS_COLORS[h.fromStatus]} sx={{ fontSize: 11 }} />
                              <ArrowForwardIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                              <Chip label={h.toStatus} size="small" color={STATUS_COLORS[h.toStatus]} sx={{ fontSize: 11 }} />
                            </Box>
                            : <Chip label="Created" size="small" variant="outlined" sx={{ fontSize: 11 }} />}
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          {h.note && <Typography variant="body2">{h.note}</Typography>}
                          <Typography variant="caption" color="text.secondary">
                            {dayjs(h.changedAt).format('MMM D, YYYY h:mm A')}
                            {h.changedBy && ` \u00b7 ${h.changedBy.firstName} ${h.changedBy.lastName}`}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </>
              )}

              {/* Comments */}
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" gutterBottom>Comments</Typography>
              {(acctDetailItem.comments ?? []).length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
                  {(() => {
                    const acctComments = acctDetailItem.comments ?? [];
                    const acctLastCommentId: number | null = acctComments.length ? acctComments[acctComments.length - 1].id : null;
                    return acctComments.map((c) => {
                      const isOwn = c.userId === user?.id;
                      const canEdit = isOwn && c.id === acctLastCommentId && !acctIsTerminal;
                      const isEditingThis = acctEditingCommentId === c.id;
                      return (
                        <Box key={c.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                          <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: isOwn ? '#4f46e5' : '#94a3b8' }}>
                            {c.user?.firstName?.[0] ?? '?'}
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
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
                                <TextField size="small" fullWidth multiline rows={2} autoFocus
                                  value={acctEditingCommentText} onChange={e => setAcctEditingCommentText(e.target.value)}
                                  disabled={updateAccountActionItemComment.isPending} sx={{ '& .MuiInputBase-root': { fontSize: 13 } }} />
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                  <Button size="small" variant="contained" onClick={handleAcctSaveEditComment}
                                    disabled={!acctEditingCommentText.trim() || updateAccountActionItemComment.isPending}
                                    startIcon={updateAccountActionItemComment.isPending ? <CircularProgress size={12} color="inherit" /> : undefined}>
                                    Save
                                  </Button>
                                  <Button size="small" onClick={handleAcctCancelEditComment} disabled={updateAccountActionItemComment.isPending}>Cancel</Button>
                                </Box>
                              </Box>
                            ) : (
                              <Typography sx={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{c.content}</Typography>
                            )}
                          </Box>
                          {!isEditingThis && (
                            <Box sx={{ display: 'flex', flexShrink: 0 }}>
                              {canEdit && (
                                <Tooltip title="Edit comment">
                                  <IconButton size="small" onClick={() => handleAcctStartEditComment(c)} sx={{ mt: -0.5 }}>
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {(isOwn || isSuperuser) && !acctIsTerminal && (
                                <Tooltip title="Delete comment">
                                  <IconButton size="small" color="error" onClick={() => handleAcctDeleteComment(c.id)}
                                    disabled={acctDeletingCommentId === c.id} sx={{ mt: -0.5 }}>
                                    {acctDeletingCommentId === c.id ? <CircularProgress size={14} /> : <DeleteOutlineIcon fontSize="small" />}
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          )}
                        </Box>
                      );
                    });
                  })()}
                </Box>
              )}
              {!acctIsTerminal && (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField size="small" fullWidth multiline rows={2} placeholder="Add a comment..."
                    value={acctCommentText} onChange={e => setAcctCommentText(e.target.value)}
                    disabled={addAccountActionItemComment.isPending} sx={{ '& .MuiInputBase-root': { fontSize: 13 } }} />
                  <Button variant="contained" size="small" onClick={handleAcctAddComment}
                    disabled={!acctCommentText.trim() || addAccountActionItemComment.isPending}
                    sx={{ alignSelf: 'flex-end', minWidth: 64 }}
                    startIcon={addAccountActionItemComment.isPending ? <CircularProgress size={12} color="inherit" /> : undefined}>
                    Post
                  </Button>
                </Box>
              )}
            </DialogContent>
            {acctEditing && (
              <DialogActions>
                <Button onClick={() => { setAcctEditing(false); setAcctEditError(''); }} disabled={updateAccountActionItem.isPending}>Cancel</Button>
                <Button variant="contained" onClick={handleAcctSaveEdit} disabled={updateAccountActionItem.isPending}
                  startIcon={updateAccountActionItem.isPending ? <CircularProgress size={14} /> : <SaveIcon />}>Save</Button>
              </DialogActions>
            )}
          </Dialog>
        );
      })()}

      {/* Account Item Transition Dialog */}
      <Dialog open={acctTransitionOpen} onClose={() => setAcctTransitionOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Move to &quot;{acctTargetStatus}&quot;</DialogTitle>
        <DialogContent>
          <TextField multiline minRows={3} fullWidth variant="outlined"
            label={acctTargetStatus === 'Closed' || acctTargetStatus === 'Discarded' ? `${acctTargetStatus === 'Closed' ? 'Closing' : 'Discard'} comment (required)` : 'Note (optional)'}
            value={acctTransitionNote} onChange={e => setAcctTransitionNote(e.target.value)}
            required={acctTargetStatus === 'Closed' || acctTargetStatus === 'Discarded'}
            sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAcctTransitionOpen(false)} disabled={transitionAccountActionItemStatus.isPending}>Cancel</Button>
          <Button variant="contained" onClick={handleAcctTransition}
            disabled={transitionAccountActionItemStatus.isPending || ((acctTargetStatus === 'Closed' || acctTargetStatus === 'Discarded') && !acctTransitionNote.trim())}
            color={acctTargetStatus === 'Closed' ? 'success' : acctTargetStatus === 'Discarded' ? 'error' : 'primary'}
            startIcon={transitionAccountActionItemStatus.isPending ? <CircularProgress size={14} /> : <ArrowForwardIcon />}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Account Item Create Dialog */}
      <CreateActionItemForm
        tab={activeTab}
        accounts={accounts}
        selectedAccount={String(propAccount?.id)}
        createOpen={acctCreateOpen}
        setCreateOpen={setAcctCreateOpen}
        handleCreate={handleAcctCreate}
        actionItem={createAccountActionItem}
        createDialogList={[]}
      />

      {/* Account Item Delete Confirm */}
      {!!acctDeleteId && <ConfirmationDialog
        title="Delete Account Action Item?"
        message="This will permanently delete the account action item and its history."
        action="Delete"
        closeButtonText="Cancel"
        ActionButtonColor="primary"
        confirm={handleAcctDelete}
        setShowAlert={() => { }}
        onClose={() => {
          setAcctDeleteId(null);
        }}
      />}
    </Box>
  );
};

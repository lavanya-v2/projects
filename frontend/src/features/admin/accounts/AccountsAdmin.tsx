/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAdminAccounts,
  useAdminDeleteAccount,
} from './hooks';
import { useAdminProjects, useAdminDeleteProject } from '../projects/hooks';
import { useAdminTeamMembers, useAdminDeleteTeamMember } from '../team-members/hooks';
import type { Account } from './types';
import { membersForAccount } from './helpers';
import { AdminBreadcrumb } from './components/AdminBreadcrumb';
import type { AdminView } from './components/AdminBreadcrumb';
import { AccountsListView } from './components/AccountsListView';
import { AccountDetailView } from './components/AccountDetailView';
import { ProjectDetailView } from './components/ProjectDetailView';
import { AccountFormDialog } from './components/dialogs/AccountFormDialog';
import { ProjectFormDialog } from './components/dialogs/ProjectFormDialog';
import { AccountMemberDialog } from './components/dialogs/AccountMemberDialog';
import { EditProjectRoleDialog } from './components/dialogs/EditProjectRoleDialog';
import { AddProjectMemberDialog } from './components/dialogs/AddProjectMemberDialog';
import { ConfirmDeleteDialog } from './components/dialogs/ConfirmDeleteDialog';
import ReusableSnackbar from '../../../shared/components/ReusableSnackbar';

/**
 * Discriminated union of all dialog states. The payload lives with the dialog
 * kind so the parent never holds orphaned form data when nothing is open.
 */
type DialogState =
  | { kind: 'none' }
  | { kind: 'accountForm'; editing: Account | null }
  | { kind: 'deleteAccount'; target: Account }
  | { kind: 'projectForm'; editing: any | null; defaultAccountId?: number | '' }
  | { kind: 'deleteProject'; target: any }
  | { kind: 'accountMember' }
  | { kind: 'editMember'; member: any }
  | { kind: 'deleteMember'; target: any }
  | { kind: 'editProjectRole'; memberId: number; currentRole: string; currentDailyCapacity?: number | null }
  | { kind: 'addProjectMember'; availableMembers: any[] };

const CLOSED: DialogState = { kind: 'none' };

/**
 * Accounts administration root. Owns only view state, selection, dialog
 * orchestration, and the error/success banner. All forms, tables, and
 * permission-free rendering are delegated to focused child components.
 */
export function AccountsAdmin() {
  const queryClient = useQueryClient();

  // ── Server data ─────────────────────────────────────────────────────────
  const { data: accounts = [], isLoading: accountsLoading } = useAdminAccounts();
  const { data: allProjects = [], isLoading: projectsLoading } = useAdminProjects();
  const { data: allMembers = [], isLoading: membersLoading } = useAdminTeamMembers();
  const loading = accountsLoading || projectsLoading || membersLoading;

  const deleteAccount = useAdminDeleteAccount();
  const deleteProject = useAdminDeleteProject();
  const deleteMember = useAdminDeleteTeamMember();

  // ── View + selection state (IDs only — objects are derived) ─────────────
  const [view, setView] = useState<AdminView>('accounts');
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);

  // Derive selected objects from query data so mutations auto-sync.
  const selectedAccount = useMemo(
    () => accounts.find(a => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );
  const selectedProject = useMemo(
    () => allProjects.find(p => p.id === selectedProjectId) ?? null,
    [allProjects, selectedProjectId],
  );

  // ── Notification helpers ────────────────────────────────────────────────
  const showError = (msg: string) => { setSnackbar({ msg, severity: 'error' }); };
  const showSuccess = (msg: string) => { setSnackbar({ msg, severity: 'success' }); };

  // Invalidate team members after dialogs whose mutations don't already do so.
  // (Project-member add/remove invalidate the project's members; the
  //  team-members list view also needs a refresh for association changes.)
  const refreshTeamMembers = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-team-members'] });

  // ── Navigation handlers ─────────────────────────────────────────────────
  const goTo = (v: AdminView) => setView(v);
  const openAccount = (acc: Account) => { setSelectedAccountId(acc.id); setView('account'); };
  const openProject = (p: any) => { setSelectedProjectId(p.id); setView('project'); };

  // ── Delete handlers ─────────────────────────────────────────────────────
  const getErrorMessage = (error: unknown, fallback = 'Delete failed'): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null) {
      const maybeAxiosError = error as Record<string, any>;
      const message = maybeAxiosError.response?.data?.message;
      if (typeof message === 'string') return message;
    }
    return fallback;
  };

  const handleDeleteAccount = async () => {
    if (dialog.kind !== 'deleteAccount') return;
    try {
      await deleteAccount.mutateAsync(dialog.target.id);
      showSuccess('Account deleted');
      setDialog(CLOSED);
      if (selectedAccountId === dialog.target.id) {
        setSelectedAccountId(null);
        setView('accounts');
      }
    } catch (e: unknown) {
      showError(getErrorMessage(e));
      setDialog(CLOSED);
    }
  };

  const handleDeleteProject = async () => {
    if (dialog.kind !== 'deleteProject') return;
    try {
      await deleteProject.mutateAsync(dialog.target.id);
      showSuccess('Project deleted');
      setDialog(CLOSED);
      if (selectedProjectId === dialog.target.id) {
        setSelectedProjectId(null);
        if (view === 'project') setView('account');
      }
    } catch (e: unknown) {
      showError(getErrorMessage(e));
      setDialog(CLOSED);
    }
  };

  const handleDeleteMember = async () => {
    if (dialog.kind !== 'deleteMember') return;
    try {
      await deleteMember.mutateAsync(dialog.target.id);
      showSuccess('Team member deleted');
      setDialog(CLOSED);
    } catch (e: unknown) {
      showError(getErrorMessage(e));
      setDialog(CLOSED);
    }
  };

  const closeDialog = () => setDialog(CLOSED);

  // Wrap onSuccess for dialogs that change project<->member associations so
  // the team-members list stays fresh (its query isn't auto-invalidated by
  // project-member mutations).
  const onMemberMutationSuccess = (msg: string) => {
    showSuccess(msg);
    refreshTeamMembers();
  };

  // ── Derived data for dialogs ────────────────────────────────────────────
  const accountProjects = selectedAccount
    ? allProjects.filter(p => p.accountId === selectedAccount.id)
    : [];
  const accountMembers = selectedAccount
    ? membersForAccount(allMembers, allProjects, selectedAccount.id)
    : [];

  return (
    <Box>
      <AdminBreadcrumb
        view={view}
        account={selectedAccount}
        project={selectedProject}
        onNavigate={goTo}
      />

      <ReusableSnackbar
        snackbar={snackbar} 
        setSnackbar={setSnackbar}>
      </ReusableSnackbar>

      {view === 'accounts' && (
        <AccountsListView
          accounts={accounts}
          loading={loading}
          onCreate={() => setDialog({ kind: 'accountForm', editing: null })}
          onEdit={acc => setDialog({ kind: 'accountForm', editing: acc })}
          onDelete={acc => setDialog({ kind: 'deleteAccount', target: acc })}
          onSelect={openAccount}
        />
      )}

      {view === 'account' && selectedAccount && (
        <AccountDetailView
          account={selectedAccount}
          onEditAccount={acc => setDialog({ kind: 'accountForm', editing: acc })}
          onDeleteAccount={acc => setDialog({ kind: 'deleteAccount', target: acc })}
          onCreateProject={() => setDialog({ kind: 'projectForm', editing: null, defaultAccountId: selectedAccount.id })}
          onEditProject={p => setDialog({ kind: 'projectForm', editing: p })}
          onDeleteProject={p => setDialog({ kind: 'deleteProject', target: p })}
          onSelectProject={openProject}
          onAddMember={() => setDialog({ kind: 'accountMember' })}
          onEditMember={m => setDialog({ kind: 'editMember', member: m })}
          onDeleteMember={m => setDialog({ kind: 'deleteMember', target: m })}
        />
      )}

      {view === 'project' && selectedProject && (
        <ProjectDetailView
          project={selectedProject}
          allMembers={allMembers}
          onEditProject={p => setDialog({ kind: 'projectForm', editing: p })}
          onDeleteProject={p => setDialog({ kind: 'deleteProject', target: p })}
          onAddProjectMember={availableMembers => setDialog({ kind: 'addProjectMember', availableMembers })}
          onEditRole={(memberId, currentRole, currentDailyCapacity) => setDialog({ kind: 'editProjectRole', memberId, currentRole, currentDailyCapacity })}
          onError={showError}
          onSuccess={onMemberMutationSuccess}
        />
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}

      <AccountFormDialog
        open={dialog.kind === 'accountForm'}
        editing={dialog.kind === 'accountForm' ? dialog.editing : null}
        onClose={closeDialog}
        onSuccess={showSuccess}
        onError={showError}
      />

      <ProjectFormDialog
        open={dialog.kind === 'projectForm'}
        editing={dialog.kind === 'projectForm' ? dialog.editing : null}
        accounts={accounts}
        defaultAccountId={dialog.kind === 'projectForm' ? dialog.defaultAccountId : undefined}
        onClose={closeDialog}
        onSuccess={showSuccess}
        onError={showError}
        setSnackbar={setSnackbar}
      />

      <AccountMemberDialog
        open={dialog.kind === 'accountMember' || dialog.kind === 'editMember'}
        formMode={dialog.kind === 'accountMember' ? "create" : "edit"}
        accountId={selectedAccount?.id ?? null}
        member={dialog.kind === 'editMember' ? dialog.member : null}
        accountProjects={dialog.kind === 'accountMember' ? accountProjects : allProjects}
        availableToLink={dialog.kind === 'accountMember' ? accountMembers : null}
        onClose={closeDialog}
        onSuccess={onMemberMutationSuccess}
        onError={showError}
      />

      <EditProjectRoleDialog
        open={dialog.kind === 'editProjectRole'}
        projectId={selectedProject?.id ?? null}
        memberId={dialog.kind === 'editProjectRole' ? dialog.memberId : null}
        currentRole={dialog.kind === 'editProjectRole' ? dialog.currentRole : ''}
        currentDailyCapacity={dialog.kind === 'editProjectRole' ? dialog.currentDailyCapacity : null}
        estimationType={selectedProject?.estimationType}
        onClose={closeDialog}
        onSuccess={onMemberMutationSuccess}
        onError={showError}
      />

      <AddProjectMemberDialog
        open={dialog.kind === 'addProjectMember'}
        projectId={selectedProject?.id ?? null}
        projectName={selectedProject?.name ?? ''}
        availableMembers={dialog.kind === 'addProjectMember' ? dialog.availableMembers : []}
        estimationType={selectedProject?.estimationType}
        onClose={closeDialog}
        onSuccess={onMemberMutationSuccess}
        onError={showError}
      />

      <ConfirmDeleteDialog
        open={dialog.kind === 'deleteAccount'}
        title="Delete Account?"
        message={
          dialog.kind === 'deleteAccount'
            ? <>Delete <b>{dialog.target.name}</b>? This cannot be undone. Projects must be removed first.</>
            : ''
        }
        onConfirm={handleDeleteAccount}
        onClose={closeDialog}
      />

      <ConfirmDeleteDialog
        open={dialog.kind === 'deleteProject'}
        title="Delete Project?"
        message={
          dialog.kind === 'deleteProject'
            ? <>Delete <b>{dialog.target.name}</b>? This cannot be undone.</>
            : ''
        }
        onConfirm={handleDeleteProject}
        onClose={closeDialog}
      />

      <ConfirmDeleteDialog
        open={dialog.kind === 'deleteMember'}
        title="Delete Team Member?"
        message={
          dialog.kind === 'deleteMember'
            ? <>Delete <b>{dialog.target.firstName} {dialog.target.lastName}</b>? All project assignments will also be removed.</>
            : ''
        }
        onConfirm={handleDeleteMember}
        onClose={closeDialog}
      />
    </Box>
  );
}

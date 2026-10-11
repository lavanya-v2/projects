import { useState, useEffect } from "react";
import {
  Box,
  Paper,
  CircularProgress,
  Alert,
} from "@mui/material";
import { useAuth } from "../../../context/AuthContext";
import {
  ActionItemDetailModal,
} from "../ActionItemDetailModal";
import {
  useProgramActionItem,
  useMyProgramActionItems,
  useCreateProgramActionItem,
  useDeleteProgramActionItem,
} from "../hooks";
import { useAccessiblePrograms } from "../../programs/hooks";
import type { Account } from "../../admin/accounts/types";
import type { Program } from "../../programs/types";
import type {
  ActionItemType,
  ActionItemCreateData,
  PaginatedResponse,
  SortConfig,
} from "../types";
import { FilterChips } from "../ActionItemsPage";
import { CreateActionItemForm } from "../CreateActionItemForm";
import ConfirmationDialog from "../../../shared/components/ConfirmationDialog";
import type { ActionItemFormValues } from "../schema";
import ActionItemTable from "../ActionItemTable";
import ActionItemFilters from "../ActionItemFilters";
import { ActionItemHeader } from "../ActionItemHeader";

const initialCreateData: ActionItemCreateData = {
  accountId: "",
  title: "",
  category: "Task",
  owner: "",
  dueDate: "",
};

interface Props {
  accounts: Account[];
  selectedAccount?: Account | null;
  activeTab: string;
}

export const ProgramActionItems = ({
  accounts,
  selectedAccount: propAccount,
  activeTab,
}: Props) => {
  const [page, setPage] = useState(1);
  const limit = 10;
  const { user } = useAuth();
  const isLead = user?.roleName === "lead";
  const isSuperuser = user?.role === "SUPERUSER" || user?.roleName === "superuser";
  const isAdmin = user?.roleName === "admin";
  const isManager = user?.roleName === "manager";

  const [selectedAccount, setSelectedAccount] = useState<string>(propAccount?.id ? String(propAccount.id) : "all");
  const [searchFilter, setSearchFilter] = useState("");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [progError, setProgError] = useState("");
  const [selectedProgram, setSelectedProgram] = useState("all");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  // Applied: changed only when Apply or Clear is clicked
  const [appliedFilters, setAppliedFilters] = useState({
    program: "all",
    status: [] as string[],
    category: [] as string[],
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [programSortConfig, setProgramSortConfig] = useState<SortConfig | undefined>();

  const [selectedProgDetailId, setSelectedProgDetailId] = useState<number | null>(null);
  const [progDetailItem, setProgDetailItem] = useState<ActionItemType | null>(null);
  const [progDetailOpen, setProgDetailOpen] = useState(false);
  const [progCreateOpen, setProgCreateOpen] = useState(false);
  const [progCreateData, setProgCreateData] = useState<ActionItemCreateData>({
    ...initialCreateData,
    programId: "",
  });
  const [progDeleteId, setProgDeleteId] = useState<number | null>(null);

  // Resolve a specific account when one is picked. 'all' means every permitted account.
  const accObj =
    selectedAccount && selectedAccount !== "all" ?
      accounts.find(
        (a) =>
          String(a.id) === String(selectedAccount) ||
          a.name === selectedAccount,
      )
      : undefined;
  const accId = accObj ? Number(accObj.id) : undefined;

  // Project list query — undefined accountId means "all accounts" which the
  // projects API treats as every project the user is permitted to see.
  // Phase 1.6: Action Items are Jira-only; Excel projects hidden from the picker.

  // Action items are fetched once per tab as a single aggregate request (the
  // server resolves the user's accessible scope). The Account / Project /
  // Program dropdowns then filter that set in memory — no per-entity fan-out,
  // no connection-pool flooding. Each query is gated to its active tab.

  // Sync global account selection
  useEffect(() => {
    if (propAccount?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedAccount(String(propAccount.id));
      setSelectedProgram("all");
      setSearchFilter("");
      setPage(1);
    }
  }, [propAccount?.id]);

  const handleSearch = (value: string) => {
    setPage(1);
    setSearchFilter(value);
  };

  const handleClear = () => {
    setPage(1);
    setSearchFilter("");
  };

  //program filter handler
  const handleProgramFilter = () => {
    setAppliedFilters({
      program: selectedProgram,
      status: [...statusFilter],
      category: [...categoryFilter],
    });
    setPage(1);
    setAnchorEl(null);
  };

  const handleProgramClearFilters = () => {
    setStatusFilter([]);
    setCategoryFilter([]);
    setSelectedProgram("all");
    setAppliedFilters({
      program: "all",
      status: [],
      category: [],
    });
    setIsExpanded(false);
    setAnchorEl(null);
    setPage(1);
  };

  const handleProgramClearFilter = (type: string, value: string) => {
    if (type === "status") {
      setStatusFilter((prevValue) => prevValue.filter((statusName) => statusName !== value));
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
    if (type === "program") {
      setSelectedProgram("all");
      setAppliedFilters((prev) => ({ ...prev, program: "all" }));
    }
  };

  const handleSortRequest = (columnName: "status" | "category" | "dueDate") => {
    const getNextConfig = (
      currentConfig: SortConfig | undefined,
    ): SortConfig => {
      const isCurrentDesc =
        currentConfig?.column === columnName &&
        currentConfig?.direction === "DESC";
      return {
        column: columnName,
        direction: isCurrentDesc ? "ASC" : ("DESC" as const),
      };
    };
    setProgramSortConfig(getNextConfig(programSortConfig));
    setPage(1);
  };

  // Accessible programs (for the Program tab), filtered to the selected account.
  const { data: accessiblePrograms = [] } = useAccessiblePrograms();
  const programList = accessiblePrograms.filter((p: Program) => selectedAccount === "all" || String(p.accountId) === String(accId));

  const { data: allProgItems = [], isLoading: progLoading, isError: progItemsError } = useMyProgramActionItems(
    propAccount?.id ? (propAccount.id as number) : 0,
    activeTab === "program-items",
    appliedFilters.status.length > 0 ? appliedFilters.status : undefined,
    searchFilter.trim() === "" ? undefined : searchFilter,
    programSortConfig,
    selectedProgram === "all" ? undefined : selectedProgram,
    appliedFilters.category.length > 0 ? appliedFilters.category : undefined,
    page,
    limit,
  );

  const allProgramItems = allProgItems as unknown as PaginatedResponse<ActionItemType>;
  const progList = allProgramItems?.data ?? [];
  const programItems = progList.map((item) => ({
    ...item,
    relatedName: programList.find((program) => program.id === item.programId)?.name || "-",
  }));
  const totalProgItems: number = allProgramItems?.totalItems ?? 0;

  // Detail item fetch via hook (program)
  const { data: fetchedProgDetailItem } = useProgramActionItem(selectedProgDetailId);
  useEffect(() => {
    if (fetchedProgDetailItem) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgDetailItem(fetchedProgDetailItem);
      setProgDetailOpen(true);
    }
  }, [fetchedProgDetailItem]);

  // Mutations
  const createProgramActionItem = useCreateProgramActionItem();
  const deleteProgramActionItem = useDeleteProgramActionItem();

  // Open the project create dialog. Pre-fills account/project from the listing
  // filter when the user already has a specific one chosen — purely a convenience.
  // The form does NOT depend on the filter state.

  // Load the dialog's own project list whenever the user picks an account
  // inside the dialog. Independent of the listing filter's projectList.

  // ── Program action item handlers ─────────────────────────────────────────
  const handleOpenProgCreateDialog = () => {
    const preAccountId = selectedAccount && selectedAccount !== "all" ? String(selectedAccount) : "";
    const preProgramId = selectedProgram && selectedProgram !== "all" ? String(selectedProgram) : "";
    setProgCreateData({
      accountId: preAccountId,
      programId: preProgramId,
      title: "",
      category: "Task",
      owner: "",
      dueDate: "",
    });
    setProgCreateOpen(true);
  };

  // Programs available inside the create dialog, scoped to the dialog's account pick.
  const progCreateDialogPrograms = accessiblePrograms.filter(
    (p: Program) => !progCreateData.accountId || String(p.accountId) === String(progCreateData.accountId),
  );

  const handleProgCreate = async (data: ActionItemFormValues) => {
    if (data.tab !== "program-items") return;

    await createProgramActionItem.mutateAsync({
      programId: Number(data.programId),
      data: {
        title: data.title,
        category: data.category,
        owner: data.owner,
        dueDate: data.dueDate || null,
      },
    });

    setProgCreateOpen(false);
  };

  const handleProgOpenDetail = (item: ActionItemType) => {
    setSelectedProgDetailId(item.id);
  };

  const handleProgDelete = async () => {
    if (!progDeleteId) return;
    try {
      await deleteProgramActionItem.mutateAsync(progDeleteId);
      setProgDeleteId(null);
      setProgDetailOpen(false);
      setSelectedProgDetailId(null);
      setProgDetailItem(null);
      if (progList.length === 1) {
        setPage(page - 1);
      }
    } catch (err) {
      const errorWithResponse = err as {
        response?: { data?: { error?: string } };
        message?: string;
      };
      setProgError(
        errorWithResponse?.response?.data?.error ??
        "Failed to delete program action item.",
      );
    }
  };

  const hasAppliedFilters = appliedFilters.program !== 'all' || (appliedFilters.status && appliedFilters.status.length > 0) || (appliedFilters.category && appliedFilters.category.length > 0);
  const sameValues = (a: string[], b: string[]) =>
    a.length === b.length &&
    a.every((value) => b.includes(value));

  const hasFilterChanges = selectedProgram !== appliedFilters.program || !sameValues(statusFilter, appliedFilters.status) || !sameValues(categoryFilter, appliedFilters.category);

  const programName = programList.find((p) => String(p.id) === String(selectedProgram));
  const progName = programName ? programName.name : "";

  const progActiveFilters = [
    ...(progName ? [{ type: "program", label: progName }] : []),
    ...appliedFilters.status.map((status) => ({ type: "status", label: status })),
    ...appliedFilters.category.map((category) => ({
      type: "category",
      label: category,
    })),
  ];

  const programVisibleFilters = isExpanded ? progActiveFilters : progActiveFilters.slice(0, 5);
  const programRemainingCount = progActiveFilters.length - 5;

  return (
    <Box>
      {/* Program Items Tab */}
      {activeTab === "program-items" && (
        <>
          <Paper sx={{ mb: 4, overflow: "hidden" }}>
            <ActionItemHeader tabName="Program" handleOpenCreateDialog={handleOpenProgCreateDialog} />

            <Box sx={{ p: 3 }}>
              {(progError || progItemsError) && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {progError || "Failed to load program action items."}
                </Alert>
              )}

              {/* Selectors */}
              <ActionItemFilters
                onSearch={handleSearch}
                onClearSearch={handleClear}
                open={Boolean(anchorEl)}
                anchorEl={anchorEl}
                onPopoverOpen={(e) => setAnchorEl(e.currentTarget)}
                onPopoverClose={() => setAnchorEl(null)}
                entityLabel="Program"
                entityValue={selectedProgram}
                entityOptions={programList}
                onEntityChange={(value) => setSelectedProgram(String(value))}
                entityPosition="inside"
                statusFilter={statusFilter}
                onStatusChange={setStatusFilter}
                categoryFilter={categoryFilter}
                onCategoryChange={setCategoryFilter}
                activeFilters={hasAppliedFilters}
                onApply={handleProgramFilter}
                onClear={handleProgramClearFilters}
                hasFilterChanges={hasFilterChanges}
              />

              {hasAppliedFilters && (
                <FilterChips
                  visibleFilters={programVisibleFilters}
                  isExpanded={isExpanded}
                  activeFilters={progActiveFilters}
                  remainingCount={programRemainingCount}
                  onClick={(type: string, value: string) => handleProgramClearFilter(type, value)}
                  onClear={handleProgramClearFilters}
                  onClickExpanded={(
                    val: boolean | ((prevState: boolean) => boolean),
                  ) => setIsExpanded(val)}
                />
              )}

              {/* Table */}
              {progLoading ?
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress />
                </Box>
                : <ActionItemTable
                  items={programItems}
                  totalItems={totalProgItems}
                  page={page}
                  limit={limit}
                  tab={activeTab}
                  relatedColumnLabel="Program"
                  sortConfig={programSortConfig}
                  onSortRequest={handleSortRequest}
                  onPageChange={setPage}
                  userId={user?.id}
                  userRole={user?.roleName || ""}
                  isSuperuser={isSuperuser}
                  isAdmin={isAdmin}
                  isLead={isLead}
                  isManager={isManager}
                  onOpenDetail={handleProgOpenDetail}
                  handleTransitionClick={() => { }}
                />
              }
            </Box>
            {/* end card body */}
          </Paper>

          {/* Program Detail Modal */}
          {progDetailItem && (
            <ActionItemDetailModal
              item={progDetailItem}
              open={progDetailOpen}
              onClose={() => {
                setProgDetailOpen(false);
                setSelectedProgDetailId(null);
              }}
              onUpdated={(updated) => setProgDetailItem(updated)}
              scope="program"
              onDelete={() => setProgDeleteId(progDetailItem.id)}
              readOnly={false}
            />
          )}

          {/* Program Create Dialog */}
          <CreateActionItemForm
            tab={activeTab}
            accounts={accounts}
            selectedAccount={selectedAccount}
            createOpen={progCreateOpen}
            setCreateOpen={setProgCreateOpen}
            handleCreate={handleProgCreate}
            actionItem={createProgramActionItem}
            createDialogList={progCreateDialogPrograms}
          />

          {/* Program Delete Confirm */}
          {!!progDeleteId && (
            <ConfirmationDialog
              title="Delete Program Action Item?"
              message="This will permanently delete the program action item and its history."
              action="Delete"
              closeButtonText="Cancel"
              ActionButtonColor="primary"
              confirm={handleProgDelete}
              setShowAlert={() => { }}
              onClose={() => {
                setProgDeleteId(null);
              }}
            />
          )}
        </>
      )}
    </Box>
  );
};

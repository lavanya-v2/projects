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
  useActionItem,
  useMyProjectActionItems,
  useCreateActionItem,
  useDeleteActionItem,
} from "../hooks";
import { useProjects, useFetchProjects } from "../../auth/hooks";
import type { Account } from "../../admin/accounts/types";
import type { Project } from "../../../types";
import type {
  ActionItemType,
  ActionItemCreateData,
  PaginatedResponse,
  SortConfig,
} from "../types";
import { FilterChips } from "../ActionItemsPage";
import ConfirmationDialog from "../../../shared/components/ConfirmationDialog";
import { CreateActionItemForm } from "../CreateActionItemForm";
import type { ActionItemFormValues, ActionItemTab } from "../schema";
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
  activeTab: ActionItemTab;
}

export const ProjectActionItems = ({
  accounts,
  selectedAccount: propAccount,
  activeTab,
}: Props) => {
  const [page, setPage] = useState(1);
  const limit = 10;
  const { user } = useAuth();
  const isSuperuser = user?.role === "SUPERUSER" || user?.roleName === "superuser";
  const isAdmin = user?.roleName === "admin";
  const isManager = user?.roleName === "manager";

  const [selectedAccount, setSelectedAccount] = useState<string>(String(propAccount?.id));
  const [searchFilter, setSearchFilter] = useState("");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");
  // Draft: changed when selecting options in the popover
  const [selectedProject, setSelectedProject] = useState("all");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  // Applied: changed only when Apply or Clear is clicked
  const [appliedFilters, setAppliedFilters] = useState({
    project: "all",
    status: [] as string[],
    category: [] as string[],
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [projectSortConfig, setProjectSortConfig] = useState<SortConfig | undefined>();

  // Detail modal — store id, fetch via hook
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);
  const [detailItem, setDetailItem] = useState<ActionItemType | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Create dialog — its own account/project picks, independent of the listing filter
  const [createOpen, setCreateOpen] = useState(false);
  const [createData, setCreateData] = useState<ActionItemCreateData>({
    ...initialCreateData,
    projectId: "",
  });
  const [createDialogProjects, setCreateDialogProjects] = useState<Project[]>([]);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (propAccount?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedAccount(String(propAccount.id));
      setSelectedProject("all");
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

  //project filter handler
  const handleProjectFilter = () => {
    setAppliedFilters({
      project: selectedProject,
      status: [...statusFilter],
      category: [...categoryFilter],
    });
    setPage(1);
    setAnchorEl(null);
  };

  const handleProjectClearFilters = () => {
    setSelectedProject("all");
    setStatusFilter([]);
    setCategoryFilter([]);
    setAppliedFilters({
      project: "all",
      status: [],
      category: [],
    });
    setIsExpanded(false);
    setAnchorEl(null);
    setPage(1);
  };

  const handleProjectClearFilter = (type: string, value: string) => {
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
    if (type === "project") {
      setSelectedProject("all");
      setAppliedFilters((prev) => ({ ...prev, project: "all" }));
    }
    setPage(1);
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
    setProjectSortConfig(getNextConfig(projectSortConfig));
    setPage(1);
  };

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
  const { data: rawProjectList = [] } = useProjects(selectedAccount === "all" ? undefined : accId);
  const projectList = rawProjectList.filter(
    (p) =>
      (p.dataSourceType ?? "jira") !== "excel" &&
      (p.dataSourceType ?? "jira") !== "custom-excel",
  );

  const { data: allItems = [], isLoading: loading, isError: itemsError } = useMyProjectActionItems(
    propAccount?.id ? Number(propAccount.id) : 0,
    activeTab === "project-items",
    appliedFilters.status.length ? appliedFilters.status : undefined,
    appliedFilters.project === "all" ? undefined : Number(appliedFilters.project),
    searchFilter.trim() || undefined,
    projectSortConfig,
    appliedFilters.category.length ? appliedFilters.category : undefined,
    page,
    limit,
  );

  const allIProjectItems = allItems as unknown as PaginatedResponse<ActionItemType>;
  const projList = allIProjectItems?.data ?? [];
  const projectItems = projList.map((item) => ({
    ...item,
    relatedName: projectList.find((project) => project.id === item.projectId)?.name || "-",
  }));
  const totalProjItems: number = allIProjectItems?.totalItems ?? 0;

  // Detail item fetch via hook (project)
  const { data: fetchedDetailItem } = useActionItem(selectedDetailId);

  useEffect(() => {
    if (fetchedDetailItem) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetailItem(fetchedDetailItem);
      setDetailOpen(true);
    }
  }, [fetchedDetailItem]);

  // Mutations
  const createActionItem = useCreateActionItem();
  const deleteActionItem = useDeleteActionItem();
  const fetchProjectsImperative = useFetchProjects();

  const handleOpenDetail = (item: ActionItemType) => {
    setSelectedDetailId(item.id);
  };

  const handleDetailUpdated = (updated: ActionItemType) => {
    setDetailItem(updated);
  };

  const handleOpenCreateDialog = () => {
    const preAccountId = selectedAccount && selectedAccount !== "all" ? String(propAccount?.id) : "";
    const preProjectId = selectedProject && selectedProject !== "all" ? String(selectedProject) : "";
    setCreateData({
      accountId: preAccountId,
      projectId: preProjectId,
      title: "",
      category: "Task",
      owner: "",
      dueDate: "",
    });
    setCreateOpen(true);
  };

  // Load the dialog's own project list whenever the user picks an account
  // inside the dialog. Independent of the listing filter's projectList.
  useEffect(() => {
    if (!createOpen) return;
    if (!createData.accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCreateDialogProjects([]);
      return;
    }
    fetchProjectsImperative(parseInt(createData.accountId))
      .then((data) =>
        setCreateDialogProjects(
          data.filter(
            (p: Project) =>
              (p.dataSourceType ?? "jira") !== "excel" &&
              (p.dataSourceType ?? "jira") !== "custom-excel",
          ),
        ),
      )
      .catch(() => setCreateDialogProjects([]));
  }, [createOpen, createData.accountId, fetchProjectsImperative]);

  const handleCreate = async (data: ActionItemFormValues) => {
    if (data.tab !== "project-items") return;

    await createActionItem.mutateAsync({
      projectId: Number(data.projectId),
      data: {
        title: data.title,
        category: data.category,
        owner: data.owner,
        dueDate: data.dueDate || null,
      },
    });

    setCreateOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteActionItem.mutateAsync(deleteId);
      setDeleteId(null);
    } catch {
      setError("Failed to delete action item.");
    }
  };

  const hasAppliedFilters = appliedFilters.project !== "all" || appliedFilters.status.length > 0 || appliedFilters.category.length > 0;

  const sameValues = (a: string[], b: string[]) =>
    a.length === b.length &&
    a.every((value) => b.includes(value));

  const hasFilterChanges = selectedProject !== appliedFilters.project || !sameValues(statusFilter, appliedFilters.status) || !sameValues(categoryFilter, appliedFilters.category);
  const projectName = projectList.find((p) => String(p.id) === String(selectedProject));
  const projName = projectName ? projectName.name : "";

  const projActiveFilters = [
    ...(projName ? [{ type: "project", label: projName }] : []),
    ...appliedFilters.status.map((status) => ({ type: "status", label: status })),
    ...appliedFilters.category.map((category) => ({
      type: "category",
      label: category,
    })),
  ];

  const projectVisibleFilters = isExpanded ? projActiveFilters : projActiveFilters.slice(0, 5);
  const projectRemainingCount = projActiveFilters.length - 5;

  return (
    <Box>
      {/* Project Items Tab */}
      <>
        <Paper sx={{ mb: 4, overflow: "hidden" }}>
          {/* Card header — gradient + accent bar */}

          <ActionItemHeader tabName="Project" handleOpenCreateDialog={handleOpenCreateDialog} />

          <Box sx={{ p: 3 }}>
            {(error || itemsError) && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error || "Failed to load action items."}
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
              entityLabel="Project"
              entityValue={selectedProject}
              entityOptions={projectList}
              onEntityChange={(value) => setSelectedProject(String(value))}
              entityPosition="inside"
              statusFilter={statusFilter}
              onStatusChange={setStatusFilter}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              activeFilters={hasAppliedFilters}
              hasFilterChanges={hasFilterChanges}
              onApply={handleProjectFilter}
              onClear={handleProjectClearFilters}
            />

            {hasAppliedFilters && (
              <FilterChips
                visibleFilters={projectVisibleFilters}
                isExpanded={isExpanded}
                activeFilters={projActiveFilters}
                remainingCount={projectRemainingCount}
                onClick={(type: string, value: string) => handleProjectClearFilter(type, value)}
                onClear={handleProjectClearFilters}
                onClickExpanded={(val: boolean | ((prevState: boolean) => boolean)) => setIsExpanded(val)}
              />
            )}

            {/* Table */}
            {loading ?
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
              :
              <ActionItemTable
                items={projectItems}
                totalItems={totalProjItems}
                page={page}
                limit={limit}
                tab={activeTab}
                relatedColumnLabel="Project"
                sortConfig={projectSortConfig}
                onSortRequest={handleSortRequest}
                onPageChange={setPage}
                userId={user?.id}
                userRole={user?.roleName || ""}
                isSuperuser={isSuperuser}
                isAdmin={isAdmin}
                isLead={user?.roleName === "lead"}
                isManager={isManager}
                onOpenDetail={handleOpenDetail}
                handleTransitionClick={() => { }}
              />
            }
          </Box>
          {/* end card body */}
        </Paper>

        {/* Detail Modal */}
        {detailItem && (
          <ActionItemDetailModal
            item={detailItem}
            open={detailOpen}
            onClose={() => {
              setDetailOpen(false);
              setSelectedDetailId(null);
            }}
            onUpdated={handleDetailUpdated}
            readOnly={false}
          />
        )}

        {/* Create Dialog */}
        <CreateActionItemForm
          tab={activeTab}
          accounts={accounts}
          selectedAccount={selectedAccount}
          createOpen={createOpen}
          setCreateOpen={setCreateOpen}
          handleCreate={handleCreate}
          actionItem={createActionItem}
          createDialogList={createDialogProjects}
        />

        {/* Delete Confirm */}
        {!!deleteId && (
          <ConfirmationDialog
            title="Delete Project Action Item?"
            message="This will permanently delete the project action item and its history."
            action="Delete"
            closeButtonText="Cancel"
            ActionButtonColor="primary"
            confirm={handleDelete}
            setShowAlert={() => { }}
            onClose={() => {
              setDeleteId(null);
            }}
          />
        )}
      </>
    </Box>
  );
};

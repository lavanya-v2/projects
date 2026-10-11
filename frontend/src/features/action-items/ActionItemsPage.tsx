import { useEffect } from "react";
import { Box, Chip, Tabs, Tab, CircularProgress } from "@mui/material";
import { useAuth } from "../../context/AuthContext";
import type { Account } from "../admin/accounts/types";
import { useSearchParams } from "react-router-dom";
import { ProjectActionItems } from "./tab-components/ProjectActionItems";
import { ProgramActionItems } from "./tab-components/ProgramActionItems";
import { AccountActionItems } from "./tab-components/AccountActionItems";

interface Props {
  accounts: Account[];
  selectedAccount?: Account | null;
}

interface VisibleFilter {
  type: string;
  label: string;
}

interface FilterChips {
  visibleFilters: VisibleFilter[];
  activeFilters: VisibleFilter[];
  isExpanded: boolean;
  remainingCount: number;
  onClick: (type: string, label: string) => void;
  onClear: () => void;
  onClickExpanded: (val: boolean) => void;
}

export function FilterChips({ visibleFilters, activeFilters, isExpanded, remainingCount, onClick, onClear, onClickExpanded }: FilterChips) {
  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 1,
          pb: 2,
        }}
      >
        {visibleFilters.map((filter, index) => (
          <Chip
            key={`${filter.type}-${index}`}
            label={filter.label}
            size="small"
            onDelete={() => {
              onClick(filter.type, filter.label);
            }}
            sx={{
              fontFamily: "Inter, sans-serif",
              fontSize: 11,
              fontWeight: 600,
              bgcolor: "rgba(156, 163, 175, 0.15)",
              color: "#6b7280",
              border: "none",
              height: 22,
            }}
          />
        ))}

        {!isExpanded && remainingCount > 0 && (
          <Chip
            label={`+${remainingCount}`}
            size="small"
            clickable
            onClick={() => onClickExpanded(true)}
            sx={{
              fontFamily: "Inter, sans-serif",
              fontSize: 11,
              fontWeight: 600,
              bgcolor: "rgba(156, 163, 175, 0.15)",
              color: "#6b7280",
              border: "none",
              height: 22,
            }}
          />
        )}

        {isExpanded && activeFilters.length > 5 && (
          <Chip
            label="Show less"
            size="small"
            clickable
            onClick={() => onClickExpanded(false)}
            sx={{
              fontFamily: "Inter, sans-serif",
              fontSize: 11,
              fontWeight: 600,
              bgcolor: "rgba(156, 163, 175, 0.1)",
              color: "#6b7280",
              border: "1px #d1d5db",
              height: 22,
              "&:hover": { bgcolor: "rgba(156, 163, 175, 0.2)" },
            }}
          />
        )}
        {activeFilters.length > 0 && (
          <Chip
            label="Clear All"
            size="small"
            onClick={onClear}
            sx={{
              fontFamily: "Inter, sans-serif",
              fontSize: 11,
              fontWeight: 600,
              bgcolor: "rgba(156, 163, 175, 0.1)",
              color: "#6b7280",
              border: "1px #d1d5db",
              height: 22,
              "&:hover": { bgcolor: "rgba(156, 163, 175, 0.2)" },
            }}
          />
        )}
      </Box>
    </>
  );
}

export const ActionItemsPage = ({ accounts, selectedAccount: propAccount }: Props) => {
  const { user } = useAuth();
  const isSuperuser =
    user?.role === "SUPERUSER" || user?.roleName === "superuser";
  const isAdmin = user?.roleName === "admin";

  // Tabs
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "project-items";

  //To set the default tab to project if no tab is selected in the url
  useEffect(() => {
    if (!searchParams.get('tab')) {
      setSearchParams({ tab: 'project-items' }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (!propAccount) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Action items are fetched once per tab as a single aggregate request (the
  // server resolves the user's accessible scope). The Account / Project /
  // Program dropdowns then filter that set in memory — no per-entity fan-out,
  // no connection-pool flooding. Each query is gated to its active tab.

  return (
    <Box>
      {/* Tab switcher — Account Items only visible to superuser/admin; Program always shown */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => {
          setSearchParams({ tab: v });
        }}
        sx={{ mb: 2, borderBottom: "1px solid #e2e8f0" }}
      >
        <Tab
          label="Project Items"
          value="project-items"
          sx={{ fontSize: 13, fontWeight: 600, textTransform: "none" }}
        />
        <Tab
          label="Program Items"
          value="program-items"
          sx={{ fontSize: 13, fontWeight: 600, textTransform: "none" }}
        />
        {(isSuperuser || isAdmin) && (
          <Tab
            label="Account Items"
            value="account-items"
            sx={{ fontSize: 13, fontWeight: 600, textTransform: "none" }}
          />
        )}
      </Tabs>

      {/* Account Items Tab — superuser/admin only */}
      {activeTab === "account-items" && (isSuperuser || isAdmin) && (
        <AccountActionItems
          accounts={accounts}
          selectedAccount={propAccount}
          activeTab={activeTab}
        />
      )}

      {/* Program Items Tab */}
      {activeTab === "program-items" && (
        <ProgramActionItems
          accounts={accounts}
          selectedAccount={propAccount}
          activeTab={activeTab}
        />
      )}

      {/* Project Items Tab */}
      {activeTab === "project-items" && (
        <ProjectActionItems
          accounts={accounts}
          selectedAccount={propAccount}
          activeTab={activeTab}
        />
      )}
    </Box>
  );
};

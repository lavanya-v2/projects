import { useMemo } from "react";
import { useProjects } from "../../features/auth/hooks";
import type { Project } from "../../types";
import { useAccount } from "../../context/UseAccount";

/**
 * Returns the projects the current user can access in the active account,
 * split by data source type. Drives navigation visibility and per-page dropdown
 * filtering for Excel / Jira mixed-access users.
 *
 * Account-scoped: re-evaluates when the user switches active account.
 * Treats a missing `dataSourceType` as `'jira'` for legacy rows.
 */
export interface ActiveAccountProjects {
  loading: boolean;
  jiraProjects: Project[];
  excelProjects: Project[];
  hasJiraProjects: boolean;
  hasExcelProjects: boolean;
  // True when the account has at least one project that reports daily or weekly.
  // False when every project is sprint-based (drives hiding the Reports section).
  hasNonSprintProjects: boolean;
  // True when at least one project in the active account is set to Claude as
  // its dev-assistant tool. The single gate for every Claude-usage UI surface
  // (nav section, dashboard card, Team Prompt Coaching) — an OUTER gate in
  // front of the existing per-user pilot allowlist, so a project not on
  // Claude shows nothing Claude-related, not even "coming soon".
  hasClaudeProjects: boolean;
}

export const useActiveAccountProjects = (): ActiveAccountProjects => {
  const { activeAccount } = useAccount();
  // includeInactive=true: this hook only exposes boolean "has ANY project of
  // this type" flags (consumers never read the raw project arrays), used to
  // gate whole nav sections/routes/features. A feature must stay reachable
  // for historical access even if the account's only project of that type
  // went inactive -- it shouldn't vanish just because nothing NEW can be
  // created there anymore.
  const { data: projects = [], isLoading } = useProjects(activeAccount?.id, true);

  return useMemo<ActiveAccountProjects>(() => {
    const list = (projects ?? []) as Project[];
    const jira = list.filter((p) => (p.dataSourceType ?? "jira") !== "excel" && (p.dataSourceType ?? "jira") !== "custom-excel");
    const excel = list.filter(
      (p) =>
        p.dataSourceType === "excel" || p.dataSourceType === "custom-excel",
    );
    return {
      loading: isLoading,
      jiraProjects: jira,
      excelProjects: excel,
      hasJiraProjects: jira.length > 0,
      hasExcelProjects: excel.length > 0,
      hasNonSprintProjects: list.some(
        (p) => (p.reportingFrequency ?? "daily") !== "sprint",
      ),
      hasClaudeProjects: list.some((p) => p.devAssistantAiTool === "claude"),
    };
  }, [projects, isLoading]);
};

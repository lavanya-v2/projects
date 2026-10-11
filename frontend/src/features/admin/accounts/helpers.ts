/**
 * Pure data-derivation helpers. No React, no I/O — these just slice
 * and dice the admin data from the hooks.
 */

/** Project IDs belonging to a given account. */
const projectIdsInAccount = (allProjects: any[], accountId: number): Set<number> =>
  new Set(allProjects.filter(p => p.accountId === accountId).map(p => p.id));

/** Projects belonging to a given account. */
export const projectsForAccount = (allProjects: any[], accountId: number): any[] =>
  allProjects.filter(p => p.accountId === accountId);

/** Extract the project id from a single associationsrow (handles both shapes). */
const associationProjectId = (a: any): number | null =>
  a.projectId != null ? a.projectId : a.project?.id ?? null;

/** Members assigned to at least one project in the given account. */
export const membersForAccount = (
  allMembers: any[],
  allProjects: any[],
  accountId: number,
): any[] => {
  const ids = projectIdsInAccount(allProjects, accountId);
  return allMembers.filter(m =>
    m.accountAssociations?.some((a: any) => {
      const pid = associationProjectId(a);
      return pid != null && ids.has(pid);
    }),
  );
};

/** Distinct project names this member is assigned to within the given account. */
export const memberProjectsInAccount = (
  member: any,
  allProjects: any[],
  accountId: number,
): string[] => {
  const ids = projectIdsInAccount(allProjects, accountId);
  const names = new Set<string>();
  member.accountAssociations?.forEach((a: any) => {
    const pid = associationProjectId(a);
    if (pid != null && ids.has(pid)) {
      const name = a.project?.name ?? allProjects.find(p => p.id === pid)?.name;
      if (name) names.add(name);
    }
  });
  return Array.from(names);
};

/** Count of members assigned to a specific project. */
export const memberCountForProject = (allMembers: any[], projectId: number): number =>
  allMembers.filter(m =>
    m.accountAssociations?.some((a: any) => associationProjectId(a) === projectId),
  ).length;

/** Project role entries for a member within a specific account. */
export const memberProjectRoles = (
  member: any,
  allProjects: any[],
  accountId: number,
): { projectId: number; projectName: string; role: string }[] => {
  const ids = projectIdsInAccount(allProjects, accountId);
  return (member.accountAssociations || [])
    .filter((a: any) => {
      const pid = associationProjectId(a);
      return pid != null && ids.has(pid);
    })
    .map((a: any) => {
      const pid = associationProjectId(a) as number;
      const proj = allProjects.find(p => p.id === pid);
      return {
        projectId: pid,
        projectName: proj?.name || 'Unknown',
        role: a.role || 'Developer',
      };
    });
};

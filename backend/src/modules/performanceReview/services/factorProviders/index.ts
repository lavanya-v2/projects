import { Project } from '../../../../models/Project';
import type { SystemFactorProvider } from './types';
import { jiraFactorProvider } from './jiraFactorProvider';

export * from './types';
export { jiraFactorProvider };

/**
 * Provider registry.
 *
 * Onboarding a non-Jira project is: add a provider here, seed and confirm its
 * identity links, and return `null` for sub-metrics the source cannot supply.
 * Nothing else in the module changes — cycles, scoring, coverage, reviews and
 * every screen consume `RawMemberMetrics` keyed by `teamMemberId`.
 *
 * Order matters: the first provider whose `supports()` returns true wins, so more
 * specific providers must precede the general Jira one.
 */
const PROVIDERS: SystemFactorProvider[] = [
    // excelFactorProvider — deferred until the second pilot project.
    jiraFactorProvider,
];

export function providerFor(project: Project): SystemFactorProvider | null {
    return PROVIDERS.find(p => p.supports(project)) ?? null;
}

export function providerById(id: string): SystemFactorProvider | null {
    return PROVIDERS.find(p => p.id === id) ?? null;
}

export const severityOf = (h: string): number =>
    h === 'Red' ? 3 : h === 'Amber' ? 2 : 1;

/**
 * Returns the displayed health: if the manager-insights override is strictly more
 * severe than the computed health, it wins; otherwise fall back to the computed one.
 */
export const effectiveHealth = (computed: string, insightsOverride: string): string =>
    insightsOverride && severityOf(insightsOverride) > severityOf(computed)
        ? insightsOverride
        : computed;

export const healthChipColor = (h: string): 'success' | 'warning' | 'error' =>
    h === 'Green' ? 'success' : h === 'Red' ? 'error' : 'warning';

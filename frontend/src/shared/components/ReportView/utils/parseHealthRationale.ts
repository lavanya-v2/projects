export interface RationaleLine {
    dotColor: string | null; // null means "old format" — render without a dot
    text: string;
}

/**
 * Parses health-rationale text which comes in two flavours:
 *  - New: `green|text | amber|text | red|text` (coloured dot per line)
 *  - Old: `text | text | text` (plain lines, no dots)
 */
export const parseHealthRationale = (rationale: string): RationaleLine[] => {
    const isNewFormat = /^(green|amber|red)\|/.test(rationale);
    const lines = rationale.split(' | ');

    if (!isNewFormat) {
        return lines.map(text => ({ dotColor: null, text }));
    }

    return lines.map(line => {
        const sep = line.indexOf('|');
        const colorKey = line.slice(0, sep);
        const text = line.slice(sep + 1);
        const dotColor =
            colorKey === 'red' ? '#ef5350' : colorKey === 'amber' ? '#ffa726' : '#66bb6a';
        return { dotColor, text };
    });
};

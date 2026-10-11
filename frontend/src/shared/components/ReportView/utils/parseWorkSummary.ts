export interface WorkSummarySection {
    title?: string;
    entries: string[];
}

/**
 * Parses a free-form work summary string into titled sections with bulleted entries.
 * Recognises `**Title**: …` headers and extracts inline `KEY-123: description` ticket refs.
 */
export const parseWorkSummary = (workSummary: string): WorkSummarySection[] => {
    const sections: WorkSummarySection[] = [];
    let current: WorkSummarySection | null = null;

    const pushEntries = (text: string) => {
        if (!current) {
            current = { entries: [] };
            sections.push(current);
        }
        const cleaned = text.trim().replace(/^[-•*\s]+/, '');
        if (!cleaned) return;

        // Require 2+ uppercase letters to avoid mid-word splits like "A-1".
        const keyRe = /\b([A-Z]{2,}-\d+):/g;
        const matches = [...cleaned.matchAll(keyRe)];
        if (matches.length === 0) {
            current.entries.push(cleaned);
            return;
        }

        if (matches[0].index! > 0) {
            const pre = cleaned.slice(0, matches[0].index!).trim().replace(/^[-•*\s]+/, '');
            if (pre) current.entries.push(pre);
        }
        matches.forEach((m, idx) => {
            const start = m.index! + m[0].length;
            const end = idx + 1 < matches.length ? matches[idx + 1].index! : cleaned.length;
            current!.entries.push(`${m[1]}: ${cleaned.slice(start, end).trim()}`);
        });
    };

    workSummary.split('\n').forEach(line => {
        const clean = line.trim();
        if (!clean) return;
        const header = clean.match(/^\*\*(.*?)\*\*:?\s*(.*)/);
        if (header) {
            current = { title: header[1], entries: [] };
            sections.push(current);
            if (header[2].trim()) pushEntries(header[2]);
        } else {
            pushEntries(clean);
        }
    });

    return sections;
};

/** Splits a work-summary entry into { ticketKey, description } if it begins with a ticket key. */
export const matchTicketEntry = (entry: string): { key: string; description: string } | null => {
    const m = entry.match(/^([A-Z]{2,}-\d+):\s*(.*)/);
    return m ? { key: m[1], description: m[2] } : null;
};

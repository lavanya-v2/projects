export interface ParsedTicket {
    key: string;
    type: string;
    description: string;
}

export interface DetectedStatus {
    label: string;
    color: string;
}

/** Parses one ticket-details line; returns null if the line has no recognisable ticket prefix. */
export const parseTicketLine = (line: string): ParsedTicket | null => {
    const m = line.match(
        /^[\s*\-•]*([A-Z]+-\d+):\s*\[?(Story|Bug|Task|Sub-task|Sub-bug|Epic|Feature|Tech Debt|Chore)\]?\s*[-–]?\s*(.*)$/i,
    );
    return m ? { key: m[1], type: m[2], description: m[3].trim() } : null;
};

/** Splits a ticket-details blob into trimmed, non-empty lines and parses each one. */
export const parseTicketDetails = (
    ticketDetails: string,
): { lines: string[]; parsed: Array<ParsedTicket | null>; hasValid: boolean } => {
    const lines = ticketDetails.split('\n').map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(parseTicketLine);
    return { lines, parsed, hasValid: parsed.some(p => p !== null) };
};

export const typeColor = (type: string): string => {
    const t = type.toLowerCase();
    if (t === 'story') return '#1976d2';
    if (t === 'bug' || t === 'sub-bug') return '#c62828';
    if (t === 'task' || t === 'sub-task' || t === 'tech debt' || t === 'chore') return '#00695c';
    if (t === 'epic') return '#7b1fa2';
    return '#546e7a';
};

export const detectStatus = (desc: string): DetectedStatus | null => {
    const d = desc.toLowerCase();
    if (/moved to uat|in uat|advanced to uat/.test(d)) return { label: 'UAT', color: '#f57c00' };
    if (/moved to testing|advanced to testing|entered testing|in testing|testing phase/.test(d))
        return { label: 'Testing', color: '#0288d1' };
    if (/\bclosed\b|completed dev|dev complete/.test(d)) return { label: 'Done', color: '#2e7d32' };
    if (/in[\s-]progress/.test(d)) return { label: 'In Progress', color: '#1565c0' };
    if (/\bblocked\b/.test(d)) return { label: 'Blocked', color: '#c62828' };
    if (/deployed|ready for deployment/.test(d)) return { label: 'Deployed', color: '#2e7d32' };
    if (/created today|ticket created/.test(d)) return { label: 'New', color: '#546e7a' };
    if (/in review|code review/.test(d)) return { label: 'In Review', color: '#7b1fa2' };
    return null;
};

export const statusColor = (status: string): string => {
    const s = status.trim().toLowerCase();
    if (s === 'done' || s === 'closed' || s === 'resolved') return '#2e7d32';
    if (s === 'pending deployment' || s === 'deployed' || s === 'ready for deployment') return '#00897b';
    if (s === 'uat' || s === 'po review' || s === 'acceptance testing') return '#f57c00';
    if (s === 'qa' || s === 'testing' || s === 'in qa') return '#0288d1';
    if (s === 'dev complete' || s === 'pr review' || s === 'code review') return '#7b1fa2';
    if (s === 'in progress' || s === 'in development') return '#1565c0';
    if (s === 'todo' || s === 'to do' || s === 'backlog') return '#546e7a';
    if (s === 'blocked' || s === 'impediment') return '#c62828';
    if (s === 'reopened' || s === 'issues found') return '#c62828';
    return '#546e7a';
};

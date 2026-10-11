import { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { AccountsAdmin } from './accounts/AccountsAdmin';
import UserManagement from './users/UserManagement';
import { NotificationsAdmin } from './notifications/NotificationsAdmin';
import { UsageDashboard } from './usage/UsageDashboard';
import { ClaudeUsageAdmin } from './claude-usage-admin/ClaudeUsageAdmin';
import { AiSpendAdmin } from './ai-spend/AiSpendAdmin';
import { ProgramsAdmin } from '../programs/ProgramsAdmin';
import { PerformanceReviewAdmin } from '../performance-review/admin/PerformanceReviewAdmin';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

type SuperUserTab = 'accounts' | 'programs' | 'user-management' | 'performance-review' | 'notifications' | 'usage' | 'claude-usage-admin' | 'ai-spend';
// 'claude-usage-admin' (the combined Claude Usage tab — Cost Model/Monitored Orgs/Data
// Quality/Ingest Rate Limit sub-tabs, plus a superuser-only Audit Log sub-tab gated
// internally by ClaudeUsageAdmin itself) is admin-visible too, same as before it was
// consolidated — it shares the adminOrSuperuserMiddleware backend gate its sub-tabs
// have always had, so it belongs alongside the other admin-visible tabs.
//
// 'ai-spend' is admin-visible on exactly the same reasoning: /api/admin/ai-spend is
// gated by adminOrSuperuserMiddleware, so hiding it from admins here would deny a
// tab the backend is happy to serve them. 'performance-review' stays superuser-only
// (canConfigurePerformanceReview: isSuperuser) — only 'user-management', 'usage' and
// 'performance-review' are genuinely superuser-only.
type AdminTab = Extract<SuperUserTab, 'accounts' | 'programs' | 'notifications' | 'claude-usage-admin' | 'ai-spend'>;

interface TabConfig<T> {
    id: T;
    label: string;
}

const ALL_TABS: TabConfig<SuperUserTab>[] = [
    { id: 'accounts', label: 'Accounts' },
    { id: 'programs', label: 'Programs' },
    { id: 'user-management', label: 'User Management' },
    { id: 'performance-review', label: 'Performance Review' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'usage', label: 'Usage & Adoption' },
    { id: 'claude-usage-admin', label: 'Claude Usage' },
    // Deliberately separate from "Claude Usage": that tab is engineers' Claude Code
    // telemetry from the collector, this one is the app's own Anthropic API bill.
    { id: 'ai-spend', label: 'AI Spend' },
];

// Old individual top-level paths from before the Claude-usage tabs were grouped —
// kept resolving to the combined tab so any existing bookmarks/links still land
// somewhere sensible (the specific sub-tab isn't restored, just the parent).
const LEGACY_CLAUDE_PATHS = ['/claude-pricing', '/monitored-orgs', '/data-quality', '/ingest-rate-limit'];

const NAVY = '#002e5b';
const ORANGE = '#f15a24';

export function AdminPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const isSuperUser = user?.role === 'SUPERUSER';

    const superUserTabs = ALL_TABS;
    const adminTabs = ALL_TABS.filter((tab): tab is TabConfig<AdminTab> =>
        tab.id !== 'user-management' && tab.id !== 'usage' && tab.id !== 'performance-review'
    );

    const tabs = isSuperUser ? superUserTabs : adminTabs;

    // Collapsed while the Performance Review setup wizard is running — an
    // 8-tab bar for switching admin sections is irrelevant mid-wizard and was
    // just eating vertical space above it.
    const [prFullScreen, setPrFullScreen] = useState(false);

    // Resolved against the tabs this user can actually see, so a direct link to a
    // tab they lack falls back rather than selecting an invisible one. This is a
    // lookup over ALL_TABS rather than a chain of path tests, so 'ai-spend' — and
    // any tab added later — is matched by virtue of being in the list.
    const matchedTab = tabs.find(t => location.pathname.endsWith(`/${t.id}`));
    const tab = matchedTab
        ? matchedTab.id
        : LEGACY_CLAUDE_PATHS.some((p) => location.pathname.endsWith(p))
            ? 'claude-usage-admin'
            : 'accounts';

    return (
        <Box>
            {!prFullScreen && (
            <Box sx={{ borderBottom: '1px solid #e0e4ea', mb: 3 }}>
                <Tabs
                    value={tab}
                    onChange={(_, value) => navigate(`/admin/${value}`)}
                    sx={{
                        '& .MuiTab-root': {
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 13,
                            fontWeight: 500,
                            color: '#6b7280',
                            textTransform: 'none',
                            minHeight: 44,
                            px: 2,
                        },
                        '& .Mui-selected': {
                            color: `${NAVY} !important`,
                            fontWeight: 600,
                        },
                        '& .MuiTabs-indicator': {
                            backgroundColor: ORANGE,
                            height: 2,
                        },
                    }}
                >
                    {tabs.map(t => <Tab key={t.id} value={t.id} label={t.label} />)}
                </Tabs>
            </Box>
            )}

            {tab === 'accounts' && <AccountsAdmin />}
            {tab === 'programs' && <ProgramsAdmin />}
            {tab === 'user-management' && <UserManagement />}
            {tab === 'performance-review' && <PerformanceReviewAdmin onFullScreenChange={setPrFullScreen} />}
            {tab === 'notifications' && <NotificationsAdmin />}
            {tab === 'usage' && <UsageDashboard />}
            {tab === 'claude-usage-admin' && <ClaudeUsageAdmin />}
            {tab === 'ai-spend' && <AiSpendAdmin />}
        </Box>
    );
}

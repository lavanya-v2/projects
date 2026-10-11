import { useEffect } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { ClaudePricingAdmin } from '../claude-pricing/ClaudePricingAdmin';
import { MonitoredOrgsAdmin } from '../monitored-orgs/MonitoredOrgsAdmin';
import { DataQualityAdmin } from '../claude-integrity/DataQualityAdmin';
import { IngestRateLimitAdmin } from '../ingest-rate-limit/IngestRateLimitAdmin';
import { IngestAuditLogAdmin } from '../ingest-audit-log/IngestAuditLogAdmin';
import { CollectorInstallsAdmin } from '../collector-installs/CollectorInstallsAdmin';
import { usePermissions } from '../../../shared/hooks/usePermissions';
import { useSearchParams } from 'react-router-dom';

// Groups the Claude-usage/ingest admin screens (previously separate top-level admin
// tabs) under one parent tab with sub-tabs — mirrors the existing NotificationsAdmin
// pattern (local sub-tab state, not URL-reflected). "Audit Log" and "Installs"
// (ADDENDUM 11 Phase 3 / ADDENDUM 19) are superuser-only, stricter than the other
// four sub-tabs (admin-or-superuser, matching each screen's own backend gate) —
// hidden entirely for plain admins, matching the backend's superuserOnlyMiddleware.

const NAVY = '#002e5b';
const ORANGE = '#f15a24';

export function ClaudeUsageAdmin() {
    const [searchParams, setSearchParams] = useSearchParams();
    const rawParamTab = searchParams.get('tab') || "claude-pricing";
    const tab = rawParamTab;

    useEffect(()=>{
    if(!searchParams.get('tab')){
        setSearchParams({tab: 'claude-pricing'},{replace: true});
    }
    },[searchParams,setSearchParams]);
    const { isSuperuser } = usePermissions();

    return (
        <Box>
            <Tabs
                value={tab}
                onChange={(_, v) => setSearchParams({tab: v})}
                sx={{
                    mb: 2,
                    '& .MuiTab-root': { textTransform: 'none', fontSize: 13, minHeight: 40 },
                    '& .Mui-selected': { color: `${NAVY} !important`, fontWeight: 600 },
                    '& .MuiTabs-indicator': { backgroundColor: ORANGE, height: 2 },
                }}
            >
                <Tab value="claude-pricing" label="Cost Model" />
                <Tab value="monitored-orgs" label="Monitored Orgs" />
                <Tab value="data-quality" label="Data Quality" />
                <Tab value="ingest-rate-limit" label="Ingest Rate Limit" />
                {isSuperuser && <Tab value="audit-log" label="Audit Log" />}
                {isSuperuser && <Tab value="installs" label="Installs" />}
            </Tabs>
            {tab === 'claude-pricing' && <ClaudePricingAdmin />}
            {tab === 'monitored-orgs' && <MonitoredOrgsAdmin />}
            {tab === 'data-quality' && <DataQualityAdmin />}
            {tab === 'ingest-rate-limit' && <IngestRateLimitAdmin />}
            {tab === 'audit-log' && isSuperuser && <IngestAuditLogAdmin />}
            {tab === 'installs' && isSuperuser && <CollectorInstallsAdmin />}
        </Box>
    );
}

export default ClaudeUsageAdmin;

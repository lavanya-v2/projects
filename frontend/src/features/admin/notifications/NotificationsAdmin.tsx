import { useEffect } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { EventsList } from './EventsList';
import { TemplatesAdmin } from './TemplatesAdmin';
import { RulesAdmin } from './RulesAdmin';
import { LogsViewer } from './LogsViewer';
import { useSearchParams } from 'react-router-dom';

const NAVY = '#002e5b';
const ORANGE = '#f15a24';

export function NotificationsAdmin() {
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTabParam = searchParams.get("tab") || "rules";
    const tab = rawTabParam;

    //To set the default tab to project if no tab is selected in the url
    useEffect(() => {
      if (!searchParams.get('tab')) {
        setSearchParams({ tab: 'rules' }, { replace: true });
      }
    }, [searchParams, setSearchParams]);

    return (
        <Box>
            <Tabs
                value={tab}
                onChange={(_, v) => {setSearchParams({ tab: v })}}
                sx={{
                    mb: 2,
                    '& .MuiTab-root': { textTransform: 'none', fontSize: 13, minHeight: 40 },
                    '& .Mui-selected': { color: `${NAVY} !important`, fontWeight: 600 },
                    '& .MuiTabs-indicator': { backgroundColor: ORANGE, height: 2 },
                }}
            >
                <Tab value="rules" label="Rules" />
                <Tab value="templates" label="Templates" />
                <Tab value="events" label="Events" />
                <Tab value="logs" label="Logs" />
            </Tabs>
            {tab === 'rules' && <RulesAdmin />}
            {tab === 'templates' && <TemplatesAdmin />}
            {tab === 'events' && <EventsList />}
            {tab === 'logs' && <LogsViewer />}
        </Box>
    );
}

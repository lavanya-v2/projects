import { useEffect, useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { AccountSettingsPage } from './AccountSettingsPage';
import { CompetencyTemplateEditor } from './CompetencyTemplateEditor';
import { ReviewCyclesListPage } from './ReviewCyclesListPage';
import { SetupWizardPage } from './SetupWizardPage';
import { ParticipantAssignmentPage } from './ParticipantAssignmentPage';

type Sub = 'cycles' | 'assignment' | 'settings' | 'templates';

/**
 * Container for the superuser-facing performance review screens.
 *
 * Review Cycles is the default landing view — "+ Add a project" from there
 * launches the setup wizard full-screen rather than sitting alongside these
 * as a fifth peer tab. Reviewer Assignment, Account Settings and Competency
 * Templates stay as their own ongoing/one-time-ish screens.
 *
 * `selectedProjectId` lives here, not inside any one page's local state — a
 * page unmounting on tab switch used to silently forget which project was
 * picked (the "LOWA disappears" bug). Lifting it here means it survives
 * switching tabs and flows straight into the wizard.
 *
 * `onFullScreenChange` lets the parent `AdminPage` collapse its own 8-tab bar
 * while the wizard is running — that bar has nothing to do with a step in
 * progress, and stayed pinned above the wizard's own Stepper wasting space.
 */
export function PerformanceReviewAdmin({
    onFullScreenChange,
}: {
    onFullScreenChange?: (fullScreen: boolean) => void;
} = {}) {
    const [tab, setTab] = useState<Sub>('cycles');
    const [wizardOpen, setWizardOpen] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

    useEffect(() => {
        onFullScreenChange?.(wizardOpen);
        return () => onFullScreenChange?.(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wizardOpen]);

    if (wizardOpen) {
        return (
            <SetupWizardPage
                selectedProjectId={selectedProjectId}
                onSelectProject={setSelectedProjectId}
                onDone={() => { setWizardOpen(false); setTab('cycles'); }}
            />
        );
    }

    return (
        <Box>
            <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                sx={{
                    mb: 2.5,
                    minHeight: 36,
                    '& .MuiTab-root': {
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 12.5,
                        textTransform: 'none',
                        minHeight: 36,
                        px: 1.5,
                    },
                    '& .Mui-selected': { color: '#002e5b !important', fontWeight: 600 },
                    '& .MuiTabs-indicator': { backgroundColor: '#f15a24', height: 2 },
                }}
            >
                <Tab value="cycles" label="Review Cycles" />
                <Tab value="assignment" label="Reviewer Assignment" />
                <Tab value="settings" label="Account Settings" />
                <Tab value="templates" label="Competency Templates" />
            </Tabs>

            {tab === 'cycles' && <ReviewCyclesListPage onAddProject={() => setWizardOpen(true)} />}
            {tab === 'assignment' && <ParticipantAssignmentPage />}
            {tab === 'settings' && <AccountSettingsPage />}
            {tab === 'templates' && <CompetencyTemplateEditor />}
        </Box>
    );
}

export default PerformanceReviewAdmin;

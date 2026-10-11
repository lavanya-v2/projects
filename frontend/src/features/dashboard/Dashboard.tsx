import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import { useDashboardOverview } from './hooks';
import { SuperuserDashboard } from './SuperuserDashboard';
import { ManagerDashboard } from './ManagerDashboard';
import { ProjectDetailDashboard } from './ProjectDetailDashboard';
import { MemberDashboard } from '../member-dashboard/MemberDashboard';

interface Props {
    accounts?: any[];
    selectedAccount?: any;
    user?: any;
    onNavigateToProject?: (projectId: number) => void;
    onNavigateToRisks?: () => void;
    onNavigateToActionItems?: () => void;
}

export const Dashboard = ({ onNavigateToProject, onNavigateToRisks, onNavigateToActionItems }: Props) => {
    const { user } = useAuth();
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

    const { data, isLoading: loading, isError } = useDashboardOverview();
    const error = isError ? 'Failed to load dashboard. Please refresh.' : '';

    const isSuperuser = user?.role === 'SUPERUSER' || (user as any)?.roleName === 'superuser';
    const isAdmin = (user as any)?.roleName === 'admin';
    const isManager = (user as any)?.roleName === 'manager';
    const isLead = (user as any)?.roleName === 'lead';
    const isMember = !isSuperuser && !isAdmin && !isManager && !isLead;

    // Lead & Manager can switch between their personal dashboard and the Team
    // dashboard; the choice is remembered across logins. Default: My Performance.
    const [dashboardView, setDashboardView] = useState<'mine' | 'team'>(
        () => ((localStorage.getItem('dashboardView') as 'mine' | 'team') || 'mine'),
    );
    const setView = (v: 'mine' | 'team') => {
        setDashboardView(v);
        localStorage.setItem('dashboardView', v);
    };

    // Member: personal single-page, project-wise performance dashboard.
    if (isMember) {
        return <MemberDashboard />;
    }

    if (isSuperuser || isAdmin) {
        return (
            <SuperuserDashboard
                data={data}
                loading={loading}
                error={error}
                isAdmin={isAdmin}
                onNavigateToProject={onNavigateToProject}
                onNavigateToRisks={onNavigateToRisks}
                onNavigateToActionItems={onNavigateToActionItems}

            />
        );
    }

    // Lead & Manager: dual view — personal "My Performance" (MemberDashboard) and
    // the existing Team dashboard, switchable via a toggle.
    const viewToggle = (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: { xs: 2, md: 3 }, pt: 2, pb: 1 }}>
            <ToggleButtonGroup
                size="small"
                exclusive
                value={dashboardView}
                onChange={(_, v) => { if (v) setView(v); }}
            >
                <ToggleButton value="mine" sx={{ textTransform: 'none', fontWeight: 600 }}>My Performance</ToggleButton>
                <ToggleButton value="team" sx={{ textTransform: 'none', fontWeight: 600 }}>Team</ToggleButton>
            </ToggleButtonGroup>
        </Box>
    );

    if (dashboardView === 'mine') {
        return (
            <Box>
                {viewToggle}
                <MemberDashboard />
            </Box>
        );
    }

    // ----- Team view (existing behavior, unchanged) -----
    let teamContent: ReactNode;
    if (isManager) {
        teamContent = selectedProjectId ? (
            <ProjectDetailDashboard
                projectId={selectedProjectId}
                onBack={() => setSelectedProjectId(null)}
                readOnly={false}
            />
        ) : (
            <ManagerDashboard
                data={data}
                loading={loading}
                error={error}
                user={user}
                onProjectClick={setSelectedProjectId}
                onNavigateToActionItems={onNavigateToActionItems}
                onNavigateToRisks={onNavigateToRisks}
            />
        );
    } else {
        // Lead — project-centric
        const projects: any[] = data?.projects ?? [];
        if (!loading && !error && projects.length === 1 && !selectedProjectId) {
            teamContent = <ProjectDetailDashboard projectId={projects[0].id} readOnly />;
        } else if (selectedProjectId) {
            teamContent = (
                <ProjectDetailDashboard
                    projectId={selectedProjectId}
                    onBack={projects.length > 1 ? () => setSelectedProjectId(null) : undefined}
                    readOnly
                />
            );
        } else {
            teamContent = (
                <ManagerDashboard
                    data={data}
                    loading={loading}
                    error={error}
                    user={user}
                    onProjectClick={setSelectedProjectId}
                    onNavigateToRisks={onNavigateToRisks}
                />
            );
        }
    }

    return (
        <Box>
            {viewToggle}
            {teamContent}
        </Box>
    );
};

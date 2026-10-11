import { Box, Paper, Typography, Chip } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import type { DashboardAccount } from '../../types';

interface Props {
    account: DashboardAccount;
    onClick?: () => void;
}

export const AccountTile = ({ account, onClick }: Props) => {
    return (
        <Paper
            onClick={onClick}
            sx={{
                borderRadius: 2,
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,.08)',
                cursor: onClick ? 'pointer' : 'default',
                transition: 'box-shadow .15s, transform .15s',
                '&:hover': onClick ? { boxShadow: '0 4px 12px rgba(0,0,0,.12)', transform: 'translateY(-1px)' } : {},
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <Box sx={{
                px: 2.5, pt: 2, pb: 1.5,
                background: 'linear-gradient(135deg, #1565c0 0%, #1976d2 100%)',
            }}>
                <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#fff', letterSpacing: -0.3 }}>
                    {account.name}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,.7)', mt: 0.25 }}>
                    Account
                </Typography>
            </Box>

            {/* Stats grid */}
            <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <StatCell icon={<FolderIcon sx={{ fontSize: 16, color: '#1565c0' }} />} value={account.projectCount} label="Projects" />
                <StatCell icon={<AssignmentIcon sx={{ fontSize: 16, color: '#6a1b9a' }} />} value={account.openAICount} label="Open AIs" />
                <StatCell icon={<WarningAmberIcon sx={{ fontSize: 16, color: '#e65100' }} />} value={account.activeRiskCount} label="Risks" />
                <StatCell
                    icon={<AccessTimeIcon sx={{ fontSize: 16, color: '#c62828' }} />}
                    value={account.longPendingCount}
                    label="Overdue"
                    highlight={account.longPendingCount > 0}
                />
            </Box>

            {/* Project list preview */}
            {account.projects.length > 0 && (
                <Box sx={{ px: 2, pb: 2, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {account.projects.slice(0, 4).map(p => (
                        <Chip key={p.id} label={p.name} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                    ))}
                    {account.projects.length > 4 && (
                        <Chip label={`+${account.projects.length - 4} more`} size="small" sx={{ fontSize: 10, height: 20 }} />
                    )}
                </Box>
            )}
        </Paper>
    );
};

const StatCell = ({ icon, value, label, highlight }: { icon: React.ReactNode; value: number; label: string; highlight?: boolean }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {icon}
        <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color: highlight ? '#c62828' : '#0f172a', lineHeight: 1 }}>
                {value}
            </Typography>
            <Typography sx={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .5 }}>
                {label}
            </Typography>
        </Box>
    </Box>
);

import { Box, Typography } from '@mui/material';
import { useDroppable } from '@dnd-kit/core';
import { RiskCard } from './RiskCard';
import type { Risk, RiskStatus } from '../../types/risk';

interface RiskLaneProps {
    status: RiskStatus;
    risks: Risk[];
    onCardClick: (risk: Risk) => void;
    droppable?: boolean;
}

const LANE_CONFIG: Record<string, { label: string; headerBg: string; headerText: string; laneBg: string; emptyText: string }> = {
    NEW:              { label: 'New',             headerBg: '#1565c0', headerText: '#fff', laneBg: '#f0f4ff', emptyText: 'No new risks' },
    WORK_IN_PROGRESS: { label: 'In Progress',     headerBg: '#e65100', headerText: '#fff', laneBg: '#fff8f0', emptyText: 'Nothing in progress' },
    STALE:            { label: 'Stale',           headerBg: '#6a1b9a', headerText: '#fff', laneBg: '#faf0ff', emptyText: 'No stale risks' },
    DONE:             { label: 'Done ✓',          headerBg: '#37474f', headerText: '#fff', laneBg: '#f5f5f5', emptyText: 'No closed risks' },
};

export function RiskLane({ status, risks, onCardClick, droppable = true }: RiskLaneProps) {
    const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !droppable });
    const config = LANE_CONFIG[status] ?? LANE_CONFIG['NEW'];
    const highlighted = isOver && droppable;

    return (
        <Box sx={{ flex: 1, minWidth: 230, maxWidth: 310, display: 'flex', flexDirection: 'column' }}>
            {/* Lane Header */}
            <Box sx={{
                bgcolor: config.headerBg,
                color: config.headerText,
                px: 1.5,
                py: 0.75,
                borderRadius: '8px 8px 0 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <Typography fontWeight={700} fontSize="0.8rem" letterSpacing="0.04em">
                    {config.label}
                </Typography>
                <Box sx={{
                    bgcolor: 'rgba(255,255,255,0.25)',
                    color: '#fff',
                    borderRadius: '10px',
                    px: 0.75,
                    minWidth: 22,
                    textAlign: 'center',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    lineHeight: '18px'
                }}>
                    {risks.length}
                </Box>
            </Box>

            {/* Drop Zone */}
            <Box
                ref={setNodeRef}
                sx={{
                    flex: 1,
                    minHeight: 420,
                    maxHeight: 680,
                    p: 1.25,
                    bgcolor: highlighted ? config.laneBg : '#f8f9fa',
                    border: highlighted ? `2px dashed ${config.headerBg}` : '2px solid transparent',
                    borderRadius: '0 0 8px 8px',
                    transition: 'background-color 0.15s ease, border-color 0.15s ease',
                    overflowY: 'auto',
                    '&::-webkit-scrollbar': { width: 4 },
                    '&::-webkit-scrollbar-thumb': { bgcolor: '#ccc', borderRadius: 2 }
                }}
            >
                {risks.length === 0 ? (
                    <Box sx={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        height: 80, color: '#bbb', fontSize: '0.75rem', fontStyle: 'italic'
                    }}>
                        {config.emptyText}
                    </Box>
                ) : (
                    risks.map(risk => (
                        <RiskCard key={risk.id} risk={risk} onClick={onCardClick} />
                    ))
                )}
            </Box>
        </Box>
    );
}

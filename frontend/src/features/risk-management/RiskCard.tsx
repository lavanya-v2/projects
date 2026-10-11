import { Box, Typography, Chip, Tooltip } from '@mui/material';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Risk, RiskPriority } from '../../types/risk';

interface RiskCardProps {
    risk: Risk;
    onClick: (risk: Risk) => void;
}

const STICKY: Record<RiskPriority, { bg: string; topBar: string; fold: string; text: string }> = {
    CRITICAL: { bg: '#ffcdd2', topBar: '#c62828', fold: '#ef9a9a', text: '#b71c1c' },
    HIGH:     { bg: '#ffe0b2', topBar: '#e65100', fold: '#ffb74d', text: '#bf360c' },
    MEDIUM:   { bg: '#fff9c4', topBar: '#f9a825', fold: '#fff176', text: '#f57f17' },
    LOW:      { bg: '#dcedc8', topBar: '#558b2f', fold: '#aed581', text: '#33691e' },
};

const DONE_STICKY = { bg: '#eceff1', topBar: '#78909c', fold: '#b0bec5', text: '#546e7a' };

// Subtle alternating tilt per card id
const getTilt = (id: number) => [-1.5, -0.5, 0, 1, 1.5][id % 5];

function isRecent(createdAt: string): boolean {
    return (Date.now() - new Date(createdAt).getTime()) < 48 * 60 * 60 * 1000;
}

export function RiskCard({ risk, onClick }: RiskCardProps) {
    const isDone = risk.status === 'DONE';

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: risk.id,
        data: { risk },
        disabled: isDone || !risk.permissions?.canTransition
    });

    const style = isDone ? DONE_STICKY : STICKY[risk.priority];
    const tilt = getTilt(risk.id);
    const recent = !isDone && isRecent(risk.createdAt);

    return (
        <Box
            data-testid="risk-card"
            ref={setNodeRef}
            {...(isDone ? {} : listeners)}
            {...(isDone ? {} : attributes)}
            onClick={() => onClick(risk)}
            sx={{
                position: 'relative',
                width: '100%',
                bgcolor: style.bg,
                borderRadius: '3px 3px 3px 3px',
                mb: 1.5,
                cursor: isDone ? 'pointer' : (isDragging ? 'grabbing' : 'grab'),
                opacity: isDone ? 0.82 : (isDragging ? 0.85 : 1),
                transform: `${CSS.Translate.toString(transform)} rotate(${isDragging ? 0 : tilt}deg)`,
                transformOrigin: 'center top',
                transition: isDragging ? 'none' : 'transform 0.18s ease, box-shadow 0.18s ease',
                boxShadow: isDragging
                    ? '0 14px 28px rgba(0,0,0,0.25)'
                    : '2px 3px 8px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.08)',
                '&:hover': {
                    transform: isDone ? 'rotate(0deg)' : 'rotate(0deg) translateY(-3px)',
                    boxShadow: '4px 6px 16px rgba(0,0,0,0.2)',
                    zIndex: 2
                },
                userSelect: 'none',
                // Folded bottom-right corner
                '&::after': {
                    content: '""',
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 0,
                    height: 0,
                    borderStyle: 'solid',
                    borderWidth: '0 0 16px 16px',
                    borderColor: `transparent transparent ${style.fold} transparent`,
                    filter: 'brightness(0.75)',
                }
            }}
        >
            {/* Colored top bar (priority stripe) */}
            <Box sx={{
                height: 5,
                bgcolor: style.topBar,
                borderRadius: '3px 3px 0 0',
                mb: 0.75
            }} />

            <Box sx={{ px: 1.25, pb: 1.25 }}>
                {/* Priority label + badges row */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.6, flexWrap: 'wrap' }}>
                    <Typography
                        sx={{
                            fontSize: '0.6rem',
                            fontWeight: 800,
                            letterSpacing: '0.08em',
                            color: style.text,
                            textTransform: 'uppercase',
                            lineHeight: 1
                        }}
                    >
                        {risk.priority}
                    </Typography>
                    {recent && (
                        <Chip label="New" size="small" sx={{ height: 14, fontSize: '0.55rem', bgcolor: '#43a047', color: '#fff', fontWeight: 700, '& .MuiChip-label': { px: 0.75 } }} />
                    )}
                    <Box sx={{ ml: 'auto' }}>
                        <Typography sx={{ fontSize: '0.58rem', color: '#888', fontWeight: 500 }}>
                            {risk.source === 'CLIENT' ? '👤 Client' : '🏢 Internal'}
                        </Typography>
                    </Box>
                </Box>

                {/* Title */}
                <Typography
                    sx={{
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: isDone ? '#546e7a' : '#1a2332',
                        lineHeight: 1.35,
                        mb: 0.5,
                        textDecoration: isDone ? 'line-through' : 'none',
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                    }}
                >
                    {risk.title.replace('[DEMO] ', '')}
                </Typography>

                {/* Project tag */}
                {risk.project && (
                    <Typography sx={{ fontSize: '0.62rem', color: '#666', mb: 0.5, display: 'block' }}>
                        📁 {risk.project.name}
                    </Typography>
                )}

                {/* Footer: assignee + date */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.75, pr: 1.5 }}>
                    {risk.assignee ? (
                        <Tooltip title={`${risk.assignee.firstName} ${risk.assignee.lastName}`}>
                            <Box sx={{
                                width: 22, height: 22, borderRadius: '50%',
                                bgcolor: isDone ? '#90a4ae' : style.topBar,
                                color: '#fff', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700
                            }}>
                                {risk.assignee.firstName[0]}{risk.assignee.lastName[0]}
                            </Box>
                        </Tooltip>
                    ) : (
                        <Box sx={{ width: 22 }} />
                    )}
                    <Typography sx={{ fontSize: '0.6rem', color: '#888' }}>
                        {new Date(risk.notifiedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Typography>
                </Box>
            </Box>
        </Box>
    );
}

import { Alert, Box, Button, CircularProgress } from '@mui/material';
import type { HealthSuggestionController } from '../hooks/useHealthSuggestion';

interface HealthAlertsProps {
    type: 'daily' | 'weekly';
    isLead: boolean;
    health: HealthSuggestionController;
}

/** Renders the three possible health signal banners shown above the hero paper (daily only). */
export const HealthAlerts = ({ type, isLead, health }: HealthAlertsProps) => {
    if (type !== 'daily') return null;

    const {
        healthClearedFrom,
        healthCheckedNoEscalation,
        healthSuggestion,
        isApplyingHealth,
        handleAcceptSuggestion,
        dismissSuggestion,
        clearClearedFrom,
        dismissNoEscalation,
    } = health;

    return (
        <>
            {!!healthClearedFrom && (
                <Alert severity="success" sx={{ mb: 2 }} onClose={clearClearedFrom}>
                    Health override cleared. Previously escalated to <strong>{healthClearedFrom}</strong> — report is now back to computed health.
                </Alert>
            )}
            {healthCheckedNoEscalation && !healthSuggestion && !healthClearedFrom && (
                <Alert severity="info" sx={{ mb: 2 }} onClose={dismissNoEscalation}>
                    Health analyzed — no escalation signals detected in insights. Computed health stands.
                </Alert>
            )}
            {healthSuggestion && !isLead && (
                <Alert
                    severity="warning"
                    sx={{ mb: 2 }}
                    action={
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            <Button
                                size="small"
                                variant="contained"
                                color="warning"
                                onClick={handleAcceptSuggestion}
                                disabled={isApplyingHealth}
                                startIcon={
                                    isApplyingHealth ? (
                                        <CircularProgress size={12} color="inherit" />
                                    ) : undefined
                                }
                            >
                                Accept
                            </Button>
                            <Button
                                size="small"
                                onClick={dismissSuggestion}
                                disabled={isApplyingHealth}
                            >
                                Dismiss
                            </Button>
                        </Box>
                    }
                >
                    <strong>Insights suggest escalating health to {healthSuggestion.suggestedHealth}:</strong>{' '}
                    {healthSuggestion.reason}
                </Alert>
            )}
        </>
    );
};

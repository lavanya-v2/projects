import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  TextField,
  Typography,
} from '@mui/material';
import { useSavePerfOverride, useClearPerfOverride } from './hooks';

interface Props {
  projectId: number;
  syncId: number;
  score: any;
  onClose: () => void;
  onSaved: () => void;
}

interface MetricDef { key: string; label: string; unit: string }

const DEV_METRICS: MetricDef[] = [
  { key: 'deliveryPct', label: 'Delivery %', unit: '%' },
  { key: 'executionScore', label: 'Execution Score', unit: '' },
  { key: 'reopenRatePct', label: 'Reopen Rate %', unit: '%' },
  { key: 'avgCycleTimeHours', label: 'Avg Cycle Time', unit: 'hrs' },
];

const QA_METRICS: MetricDef[] = [
  { key: 'bugsRaisedCount', label: 'New Bugs', unit: '' },
  { key: 'weightedBugScore', label: 'Weighted Bug Score', unit: '' },
  { key: 'ticketsTestedCount', label: 'Tickets Tested', unit: '' },
  { key: 'avgQaCycleTimeHours', label: 'Avg QA Cycle Time', unit: 'hrs' },
  { key: 'bugEscapeRatePct', label: 'Bug Escape Rate', unit: '%' },
];

const fmt = (val: any, unit: string) => {
  if (val == null) return '—';
  const n = Number(val);
  return isNaN(n) ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}${unit ? ' ' + unit : ''}`;
};

export function PerfOverrideModal({ projectId, syncId, score, onClose, onSaved }: Props) {
  const isQa = score.memberCategory === 'qa';
  const metrics = isQa ? QA_METRICS : DEV_METRICS;

  const getInitialValues = () => {
    const vals: Record<string, string> = {};
    for (const m of metrics) {
      const ov = score.overriddenMetrics?.[m.key];
      vals[m.key] = ov != null ? String(ov) : score[m.key] != null ? String(score[m.key]) : '';
    }
    return vals;
  };

  const [values, setValues] = useState<Record<string, string>>(getInitialValues);
  const [reason, setReason] = useState<string>(score.overrideReason ?? '');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const saveOverrideMutation = useSavePerfOverride();
  const clearOverrideMutation = useClearPerfOverride();
  const saving = saveOverrideMutation.isPending;
  const clearing = clearOverrideMutation.isPending;

  const handleSave = async () => {
    setTouched(true);
    if (!reason.trim()) { setError('Please provide a reason for the override.'); return; }
    const metricsObj: Record<string, number> = {};
    for (const m of metrics) {
      const v = parseFloat(values[m.key]);
      if (!isNaN(v)) metricsObj[m.key] = v;
    }
    setError('');
    try {
      await saveOverrideMutation.mutateAsync({ projectId, syncId, jiraLoginId: score.jiraLoginId, metrics: metricsObj, reason: reason.trim() });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to save override');
    }
  };

  const handleClear = async () => {
    setError('');
    try {
      await clearOverrideMutation.mutateAsync({ projectId, syncId, jiraLoginId: score.jiraLoginId });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to clear override');
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Override Metrics
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {score.memberName} &middot; {isQa ? 'QA' : 'Developer'}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Computed values are shown in parentheses. Enter the corrected values below.
        </Typography>

        <Grid container spacing={2}>
          {metrics.map(m => (
            <Grid size={{ xs: 12, sm: 6 }} key={m.key}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                {m.label} (computed: {fmt(score[m.key], m.unit)})
              </Typography>
              <TextField
                size="small"
                fullWidth
                type="number"
                value={values[m.key]}
                onChange={e => setValues(v => ({ ...v, [m.key]: e.target.value }))}
                inputProps={{ step: 'any' }}
              />
            </Grid>
          ))}
        </Grid>

        <Divider sx={{ my: 2 }} />

        <TextField
          label="Reason for override *"
          multiline
          rows={3}
          fullWidth
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Member was on approved leave for 3 days; story points were not adjusted in Jira."
          error={touched && !reason.trim()}
          helperText={touched && !reason.trim() ? 'Reason is required' : ''}
        />
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Box>
          {score.isOverridden && (
            <Button color="error" onClick={handleClear} disabled={clearing || saving}>
              {clearing ? <CircularProgress size={16} /> : 'Clear Override'}
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={saving || clearing}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || clearing}>
            {saving ? <CircularProgress size={16} color="inherit" /> : 'Save Override'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}

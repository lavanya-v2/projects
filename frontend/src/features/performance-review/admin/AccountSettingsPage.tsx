import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControlLabel,
  MenuItem, Paper, Slider, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import { PlayArrowRounded } from '@mui/icons-material';
import { useAccount } from '../../../context/UseAccount';
import {
  useReviewConfig, useSaveReviewConfig, usePreviewCycles, useGenerateCycles,
} from '../hooks';
import type { ReviewCadence } from '../types';

const NAVY = '#002e5b';
const GREEN = '#4caf50';
const AMBER = '#ff9800';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Account-wide review settings: cadence, anchor date, weighting, and generating
 * the year's cycles.
 *
 * Deliberately one config per account — every in-scope project shares one
 * cadence/anchor/weighting so a cross-project person's number stays meaningful.
 * Which projects feed cycles is decided per project, in Project Setup, not here.
 */
export function AccountSettingsPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? null;

  const { data, isLoading } = useReviewConfig(accountId);
  const save = useSaveReviewConfig();
  const generate = useGenerateCycles();

  const [cadence, setCadence] = useState<ReviewCadence>('monthly');
  const [anchorDate, setAnchorDate] = useState('');
  const [fyStartMonth, setFyStartMonth] = useState(4);
  const [weightSystem, setWeightSystem] = useState(60);
  const [isEnabled, setIsEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Two factors in v1, so one slider is enough: lead takes the remainder and
  // customer stays at 0 (parked, and a weight-0 factor is out of scope entirely).
  const weightLead = 100 - weightSystem;

  useEffect(() => {
    const c = data?.config;
    if (!c) return;
    setCadence(c.cadence);
    setAnchorDate(String(c.anchorDate).slice(0, 10));
    setFyStartMonth(c.reviewYearStartMonth);
    setWeightSystem(Number(c.weightSystem));
    setIsEnabled(c.isEnabled);
    setDirty(false);
  }, [data?.config]);

  const onSave = () => {
    if (!accountId) return;
    save.mutate({
      accountId,
      config: {
        // scopeProjectIds intentionally omitted — the backend keeps the existing
        // list unless this call includes one; per-project scope is toggled from
        // Project Setup, not here.
        cadence,
        anchorDate,
        reviewYearStartMonth: fyStartMonth,
        weightSystem,
        weightLead,
        weightCustomer: 0,
        isEnabled,
      },
    }, { onSuccess: () => setDirty(false) });
  };

  const fyStart = useMemo(() => {
    if (!anchorDate) return null;
    const y = Number(anchorDate.slice(0, 4));
    const m = Number(anchorDate.slice(5, 7));
    const firstYear = m >= fyStartMonth ? y : y - 1;
    return `${firstYear}-${String(fyStartMonth).padStart(2, '0')}-01`;
  }, [anchorDate, fyStartMonth]);

  const { data: preview } = usePreviewCycles(
    accountId, fyStart ?? '', anchorDate ? `${Number(anchorDate.slice(0, 4)) + 1}-03-31` : '', !!fyStart && !dirty,
  );

  if (!accountId) {
    return <Alert severity="info" sx={{ fontSize: 13 }}>Select an account to configure review cycles.</Alert>;
  }
  if (isLoading) return <CircularProgress size={22} />;

  return (
    <Box>
      <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY, mb: 0.5 }}>
        Account Settings — {activeAccount?.name}
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 3 }}>
        Cadence and weighting apply to every project in this account's review scope — set once, revisit
        rarely. To add or remove a specific project, use <strong>Project Setup</strong>.
      </Typography>

      {save.isSuccess && !dirty && (
        <Alert severity="success" sx={{ mb: 2, fontSize: 13 }} onClose={() => save.reset()}>
          Configuration saved.
        </Alert>
      )}
      {save.isError && (
        <Alert severity="error" sx={{ mb: 2, fontSize: 13 }} onClose={() => save.reset()}>
          {(save.error as any)?.response?.data?.message ?? 'Could not save the configuration.'}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14, color: NAVY, mb: 1.5 }}>
          Cycle cadence
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <TextField
            select size="small" label="Cadence" sx={{ minWidth: 160 }} value={cadence}
            onChange={e => { setCadence(e.target.value as ReviewCadence); setDirty(true); }}
          >
            <MenuItem value="monthly">Monthly</MenuItem>
            <MenuItem value="quarterly">Quarterly</MenuItem>
          </TextField>
          <TextField
            size="small" type="date" label="Anchor date" sx={{ minWidth: 190 }}
            InputLabelProps={{ shrink: true }} value={anchorDate}
            onChange={e => { setAnchorDate(e.target.value); setDirty(true); }}
            helperText="Sets the day periods start on"
          />
          <TextField
            select size="small" label="Financial year starts" sx={{ minWidth: 190 }} value={fyStartMonth}
            onChange={e => { setFyStartMonth(Number(e.target.value)); setDirty(true); }}
          >
            {MONTHS.map((m, i) => <MenuItem key={m} value={i + 1}>{m}</MenuItem>)}
          </TextField>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography sx={{ fontWeight: 600, fontSize: 14, color: NAVY, mb: 0.5 }}>
          Score weighting
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#6b7280', mb: 2 }}>
          Applies to cycles opened from now on. Cycles already opened keep the weighting they were
          opened with, so published scores never change retrospectively.
        </Typography>

        <Box sx={{ maxWidth: 520, px: 1 }}>
          <Slider
            value={weightSystem} min={0} max={100} step={5}
            onChange={(_, v) => { setWeightSystem(v as number); setDirty(true); }}
            marks={[{ value: 0, label: 'All lead' }, { value: 50, label: '50/50' }, { value: 100, label: 'All data' }]}
            sx={{ color: NAVY }}
          />
          <Stack direction="row" spacing={3} sx={{ mt: 1 }}>
            <Typography sx={{ fontSize: 13 }}>
              Performance data <strong>{weightSystem}%</strong>
            </Typography>
            <Typography sx={{ fontSize: 13 }}>
              Lead review <strong>{weightLead}%</strong>
            </Typography>
            <Tooltip title="Customer feedback is not built yet. At weight 0 it is treated as out of scope — it neither counts as a perfect score nor as missing data.">
              <Typography sx={{ fontSize: 13, color: '#9ca3af' }}>
                Customer <strong>0%</strong> — not in use
              </Typography>
            </Tooltip>
          </Stack>
        </Box>

        <Divider sx={{ my: 2 }} />

        <FormControlLabel
          control={
            <Switch checked={isEnabled} onChange={e => { setIsEnabled(e.target.checked); setDirty(true); }} />
          }
          label={
            <Typography sx={{ fontSize: 13 }}>
              Enable review cycles for this account
              <Typography component="span" sx={{ fontSize: 12, color: '#6b7280', ml: 1 }}>
                (cycles cannot be opened while off)
              </Typography>
            </Typography>
          }
        />
      </Paper>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
        <Button
          variant="contained" size="small" disabled={!dirty || save.isPending || !anchorDate}
          sx={{ bgcolor: NAVY, '&:hover': { bgcolor: '#001f3d' } }}
          onClick={onSave}
        >
          Save configuration
        </Button>
        {save.isPending && <CircularProgress size={18} />}
        {dirty && <Typography sx={{ fontSize: 12, color: AMBER }}>Unsaved changes</Typography>}
      </Stack>

      {/* ── Preview & generate ──────────────────────────────────────────── */}
      {preview && preview.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14, color: NAVY, mb: 0.5 }}>
            Cycles for this financial year
          </Typography>
          <Typography sx={{ fontSize: 12, color: '#6b7280', mb: 1.5 }}>
            Generating is safe to repeat — it only adds periods that do not exist yet. History is
            included so members have a trend from day one rather than an empty chart. This list is a
            preview only — to open, lock, publish, or <strong>cancel</strong> a specific period, go to
            the <strong>Cycle Administration</strong> tab and select it there.
          </Typography>

          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            {preview.map(c => (
              <Chip
                key={c.startDate} size="small"
                label={`${c.periodLabel}${c.exists ? '' : ' +'}`}
                title={`${c.startDate} → ${c.endDate}${c.status ? ` (${c.status})` : ''}`}
                sx={{
                  fontSize: 11,
                  bgcolor: c.exists ? '#eef2f7' : '#e8f5e9',
                  color: c.exists ? '#374151' : '#1b5e20',
                  border: c.exists ? 'none' : `1px solid ${GREEN}`,
                }}
              />
            ))}
          </Stack>

          <Button
            size="small" variant="outlined" startIcon={<PlayArrowRounded />}
            disabled={generate.isPending || !preview.some(c => !c.exists)}
            onClick={() =>
              accountId && generate.mutate({ accountId, upTo: preview[preview.length - 1].endDate })
            }
          >
            Generate {preview.filter(c => !c.exists).length} missing cycle(s)
          </Button>
          {generate.data && (
            <Typography sx={{ fontSize: 12, color: '#1b5e20', mt: 1 }}>
              Created {generate.data.created}, skipped {generate.data.skipped} that already existed.
            </Typography>
          )}
        </Paper>
      )}
    </Box>
  );
}

export default AccountSettingsPage;

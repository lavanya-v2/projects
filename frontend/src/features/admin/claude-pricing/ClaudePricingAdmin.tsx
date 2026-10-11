import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Button,
  Chip,
  Alert,
  CircularProgress,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { usePricingVersions, useCreatePricingVersion } from './hooks';
import type { RateTiers } from './types';

const NAVY = '#002e5b';
const ORANGE = '#f15a24';
const BORDER = '#e0e4ea';
const TIERS: (keyof RateTiers)[] = ['input', 'output', 'cache_write', 'cache_read'];
const TIER_LABEL: Record<keyof RateTiers, string> = {
  input: 'Input',
  output: 'Output',
  cache_write: 'Cache write',
  cache_read: 'Cache read',
};
const blankTiers = (): RateTiers => ({ input: 0, output: 0, cache_write: 0, cache_read: 0 });

const fmtDate = (s: string) =>
  new Date(s).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ClaudePricingAdmin() {
  const { data: versions, isLoading, isError } = usePricingVersions();
  const createVersion = useCreatePricingVersion();

  // Editable working copy, seeded from the current (highest) version.
  const [models, setModels] = useState<Array<{ id: string; tiers: RateTiers }>>([]);
  const [fallback, setFallback] = useState<RateTiers>(blankTiers());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);

  const active = versions?.[0];

  useEffect(() => {
    if (!seeded.current && active) {
      setModels(Object.entries(active.rates.models).map(([id, tiers]) => ({ id, tiers: { ...tiers } })));
      setFallback({ ...active.rates.fallback });
      seeded.current = true;
    }
  }, [active]);

  const setTier = (idx: number, tier: keyof RateTiers, value: string) => {
    setModels((prev) => prev.map((m, i) => (i === idx ? { ...m, tiers: { ...m.tiers, [tier]: Number(value) } } : m)));
  };
  const setModelId = (idx: number, id: string) =>
    setModels((prev) => prev.map((m, i) => (i === idx ? { ...m, id } : m)));
  const removeModel = (idx: number) => setModels((prev) => prev.filter((_, i) => i !== idx));
  const addModel = () => setModels((prev) => [...prev, { id: '', tiers: blankTiers() }]);

  const dirty = useMemo(() => {
    if (!active) return false;
    const cur = JSON.stringify({
      models: Object.fromEntries(models.map((m) => [m.id, m.tiers])),
      fallback,
    });
    const orig = JSON.stringify({ models: active.rates.models, fallback: active.rates.fallback });
    return cur !== orig || note.trim().length > 0;
  }, [models, fallback, note, active]);

  const handleSave = async () => {
    setError(null);
    const ids = models.map((m) => m.id.trim());
    if (ids.some((id) => !/^[a-z][a-z0-9.\-]{0,40}$/.test(id))) {
      setError('Every model id must be lowercase letters/digits/dots/dashes (e.g. claude-opus-4-8).');
      return;
    }
    if (new Set(ids).size !== ids.length) {
      setError('Duplicate model ids.');
      return;
    }
    const rates = {
      models: Object.fromEntries(models.map((m) => [m.id.trim(), m.tiers])),
      fallback,
    };
    try {
      await createVersion.mutateAsync({ rates, note: note.trim() });
      setNote('');
      seeded.current = false; // reseed from the new active version
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to save new version.');
    }
  };

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (isError) return <Alert severity="error">Failed to load the cost model.</Alert>;

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: NAVY }}>Claude Cost Model</Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mt: 0.5, mb: 2, maxWidth: 760 }}>
        USD per 1,000,000 tokens, per model. Editing here creates a <b>new version</b> used for all
        <b> future</b> data. Historical days stay frozen to the version they were priced with, so past
        cost never changes — each day references the exact model used.
      </Typography>

      {active && (
        <Chip
          label={`Current: v${active.version} · effective ${fmtDate(active.effectiveFrom)}`}
          sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 600, mb: 2 }}
        />
      )}

      {/* Editable rates */}
      <Paper elevation={0} sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, mb: 2, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: 12, color: NAVY, bgcolor: '#fafbfc' }}>Model</TableCell>
                {TIERS.map((t) => (
                  <TableCell key={t} align="right" sx={{ fontWeight: 600, fontSize: 12, color: NAVY, bgcolor: '#fafbfc' }}>
                    {TIER_LABEL[t]}
                  </TableCell>
                ))}
                <TableCell sx={{ bgcolor: '#fafbfc', width: 44 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {models.map((m, idx) => (
                <TableRow key={idx} hover>
                  <TableCell sx={{ minWidth: 200 }}>
                    <TextField
                      value={m.id}
                      onChange={(e) => setModelId(idx, e.target.value)}
                      size="small"
                      variant="standard"
                      placeholder="claude-…"
                      slotProps={{ input: { sx: { fontSize: 13, fontFamily: 'monospace' } } }}
                    />
                  </TableCell>
                  {TIERS.map((t) => (
                    <TableCell key={t} align="right">
                      <TextField
                        value={m.tiers[t]}
                        onChange={(e) => setTier(idx, t, e.target.value)}
                        size="small"
                        type="number"
                        variant="standard"
                        slotProps={{ htmlInput: { min: 0, step: 0.05, style: { textAlign: 'right', width: 70 } } }}
                      />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Tooltip title="Remove model">
                      <IconButton size="small" onClick={() => removeModel(idx)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {/* Fallback row */}
              <TableRow sx={{ bgcolor: '#fff8f2' }}>
                <TableCell sx={{ fontWeight: 600, fontSize: 12.5, color: ORANGE }}>
                  Fallback
                  <Tooltip title="Used when a model id isn't listed above.">
                    <InfoOutlinedIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle', color: '#9ca3af' }} />
                  </Tooltip>
                </TableCell>
                {TIERS.map((t) => (
                  <TableCell key={t} align="right">
                    <TextField
                      value={fallback[t]}
                      onChange={(e) => setFallback((f) => ({ ...f, [t]: Number(e.target.value) }))}
                      size="small"
                      type="number"
                      variant="standard"
                      slotProps={{ htmlInput: { min: 0, step: 0.05, style: { textAlign: 'right', width: 70 } } }}
                    />
                  </TableCell>
                ))}
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={addModel}>Add model</Button>
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {createVersion.isSuccess && !dirty && <Alert severity="success" sx={{ mb: 2 }}>Saved a new cost-model version. Future data will use it.</Alert>}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap', mb: 3 }}>
        <TextField
          label="Note (why this change)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          size="small"
          sx={{ minWidth: 320, flexGrow: 1 }}
          placeholder="e.g. Opus price drop effective Aug 2026"
        />
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!dirty || createVersion.isPending}
          sx={{ bgcolor: NAVY, mt: 0.25 }}
        >
          {createVersion.isPending ? 'Saving…' : `Save as v${(active?.version ?? 0) + 1}`}
        </Button>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {/* History */}
      <Typography sx={{ fontSize: 14, fontWeight: 600, color: NAVY, mb: 1 }}>Version history</Typography>
      <Paper elevation={0} sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {['Version', 'Effective from', 'Models', 'Note', 'By'].map((h) => (
                <TableCell key={h} sx={{ fontWeight: 600, fontSize: 12, color: NAVY, bgcolor: '#fafbfc' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {(versions ?? []).map((v) => (
              <TableRow key={v.id} hover>
                <TableCell sx={{ fontWeight: 600 }}>
                  v{v.version}{active?.id === v.id && <Chip label="current" size="small" sx={{ ml: 1, height: 18, fontSize: 10, bgcolor: '#e8f5e9', color: '#2e7d32' }} />}
                </TableCell>
                <TableCell sx={{ fontSize: 12.5 }}>{fmtDate(v.effectiveFrom)}</TableCell>
                <TableCell sx={{ fontSize: 12.5 }}>{Object.keys(v.rates.models).length}</TableCell>
                <TableCell sx={{ fontSize: 12.5, color: '#6b7280', maxWidth: 320 }}>{v.note || '—'}</TableCell>
                <TableCell sx={{ fontSize: 12.5, color: '#6b7280' }}>{v.createdBy || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default ClaudePricingAdmin;

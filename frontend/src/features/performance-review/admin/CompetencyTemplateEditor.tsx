import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControlLabel, IconButton,
  MenuItem, Paper, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  AddRounded, DeleteOutlineRounded, ArrowUpwardRounded, ArrowDownwardRounded,
  LockRounded, ContentCopyRounded,
} from '@mui/icons-material';
import { useAccount } from '../../../context/UseAccount';
import { useTemplates, useSaveTemplate, useVersionTemplate, useSetTemplateStatus } from '../hooks';
import type { CompetencyTemplate, CompetencyInputType } from '../types';

const NAVY = '#002e5b';

interface DraftItem {
  id?: number;
  section: string;
  label: string;
  description: string;
  inputType: CompetencyInputType;
  weight: number;
  isRequired: boolean;
}

const BLANK_ITEM: DraftItem = {
  section: '', label: '', description: '', inputType: 'rating', weight: 1, isRequired: true,
};

/** A sensible starting set, so a first template is a few edits rather than a blank page. */
const STARTER_ITEMS: DraftItem[] = [
  { ...BLANK_ITEM, section: 'Delivery', label: 'Quality of work', weight: 3 },
  { ...BLANK_ITEM, section: 'Delivery', label: 'Ownership and follow-through', weight: 2 },
  { ...BLANK_ITEM, section: 'Collaboration', label: 'Communication', weight: 2 },
  { ...BLANK_ITEM, section: 'Growth', label: 'Initiative and learning', weight: 1 },
];

/**
 * Competency template authoring.
 *
 * A template that has been answered is never edited — reviews pin the version they
 * were answered under, so an in-place edit would retroactively change what a past
 * rating meant. Once `usageCount > 0` the editor offers a new version instead, and
 * says why.
 */
export function CompetencyTemplateEditor() {
  const { activeAccount } = useAccount();
  const { data: templates = [], isLoading } = useTemplates(activeAccount?.id);
  const saveTemplate = useSaveTemplate();
  const versionTemplate = useVersionTemplate();
  const setStatus = useSetTemplateStatus();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [scaleMax, setScaleMax] = useState(5);
  const [items, setItems] = useState<DraftItem[]>(STARTER_ITEMS);
  const [dirty, setDirty] = useState(false);

  const selected: CompetencyTemplate | undefined = templates.find(t => t.id === selectedId);
  const locked = (selected?.usageCount ?? 0) > 0;

  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setScaleMax(selected.ratingScaleMax);
    setItems(
      (selected.items ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(i => ({
          id: i.id,
          section: i.section ?? '',
          label: i.label,
          description: i.description ?? '',
          inputType: i.inputType,
          weight: Number(i.weight),
          isRequired: i.isRequired,
        })),
    );
    setDirty(false);
  }, [selected]);

  const startNew = () => {
    setSelectedId(null);
    setName('');
    setScaleMax(5);
    setItems(STARTER_ITEMS);
    setDirty(true);
  };

  const patchItem = (index: number, next: Partial<DraftItem>) => {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, ...next } : it)));
    setDirty(true);
  };

  const move = (index: number, delta: number) => {
    setItems(prev => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  };

  const ratingCount = items.filter(i => i.inputType === 'rating').length;
  const totalWeight = items.filter(i => i.inputType === 'rating').reduce((s, i) => s + (i.weight || 0), 0);
  const canSave =
    name.trim().length > 0 && items.every(i => i.label.trim().length > 0) && ratingCount > 0 && totalWeight > 0;

  const onSave = () =>
    saveTemplate.mutate(
      {
        id: selectedId ?? undefined,
        body: {
          name,
          scope: 'account',
          accountId: activeAccount?.id ?? null,
          ratingScaleMin: 1,
          ratingScaleMax: scaleMax,
          items: items.map((it, index) => ({
            id: it.id,
            section: it.section || null,
            label: it.label,
            description: it.description || null,
            inputType: it.inputType,
            weight: it.weight,
            isRequired: it.isRequired,
            sortOrder: index,
          })),
        } as any,
      },
      { onSuccess: t => { setSelectedId((t as any).id); setDirty(false); } },
    );

  if (!activeAccount) {
    return <Alert severity="info" sx={{ fontSize: 13 }}>Select an account to manage templates.</Alert>;
  }
  if (isLoading) return <CircularProgress size={22} />;

  return (
    <Box>
      <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY, mb: 0.5 }}>
        Competency Template
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2.5 }}>
        What leads are asked to rate. Every rated competency requires a written justification from the
        lead, and ratings at either end of the scale require a specific one.
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.5 }}>
        <TextField
          select size="small" label="Template" sx={{ minWidth: 300 }}
          value={selectedId ?? ''} onChange={e => setSelectedId(Number(e.target.value))}
        >
          {templates.map(t => (
            <MenuItem key={t.id} value={t.id}>
              {t.name} v{t.version} — {t.status}
              {(t.usageCount ?? 0) > 0 ? ` (${t.usageCount} used)` : ''}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" startIcon={<AddRounded />} onClick={startNew}>New template</Button>
        {selected && locked && (
          <Button
            size="small" startIcon={<ContentCopyRounded />} disabled={versionTemplate.isPending}
            onClick={() => versionTemplate.mutate(selected.id, { onSuccess: t => setSelectedId((t as any).id) })}
          >
            New version
          </Button>
        )}
        {(saveTemplate.isPending || versionTemplate.isPending || setStatus.isPending) && <CircularProgress size={18} />}
      </Stack>

      {locked && (
        <Alert severity="info" icon={<LockRounded />} sx={{ mb: 2, fontSize: 13 }}>
          {selected!.usageCount} review(s) have been written against this version, so it can no longer
          be changed — editing it would alter what those ratings meant. Create a new version instead;
          existing reviews stay pinned to the version they were answered under.
        </Alert>
      )}

      {selected?.status === 'draft' && !locked && (
        <Alert severity="warning" sx={{ mb: 2, fontSize: 13 }}>
          This template is a draft. Activate it before a review period opens, or leads will have
          nothing to answer.
          <Button size="small" sx={{ ml: 1 }}
            onClick={() => setStatus.mutate({ id: selected.id, status: 'active' })}>
            Activate
          </Button>
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2.5 }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <TextField
            size="small" label="Template name" sx={{ minWidth: 280 }} value={name} disabled={locked}
            onChange={e => { setName(e.target.value); setDirty(true); }}
          />
          <TextField
            select size="small" label="Rating scale" sx={{ minWidth: 160 }} value={scaleMax} disabled={locked}
            onChange={e => { setScaleMax(Number(e.target.value)); setDirty(true); }}
          >
            {[3, 4, 5, 10].map(n => <MenuItem key={n} value={n}>1 to {n}</MenuItem>)}
          </TextField>
          <Box sx={{ alignSelf: 'center' }}>
            <Tooltip title="Each competency's weight relative to the others, used to combine them into one score">
              <Chip size="small" label={`${ratingCount} rated · total weight ${totalWeight}`} sx={{ fontSize: 11 }} />
            </Tooltip>
          </Box>
        </Stack>
      </Paper>

      <Stack spacing={1.5}>
        {items.map((item, index) => (
          <Paper key={item.id ?? `new-${index}`} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <Stack>
                <IconButton size="small" disabled={locked || index === 0} onClick={() => move(index, -1)}>
                  <ArrowUpwardRounded fontSize="inherit" />
                </IconButton>
                <IconButton size="small" disabled={locked || index === items.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDownwardRounded fontSize="inherit" />
                </IconButton>
              </Stack>

              <Stack spacing={1} sx={{ flexGrow: 1 }}>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <TextField
                    size="small" label="Section" sx={{ width: 150 }} value={item.section} disabled={locked}
                    onChange={e => patchItem(index, { section: e.target.value })}
                  />
                  <TextField
                    size="small" label="Competency" sx={{ flexGrow: 1, minWidth: 220 }}
                    value={item.label} disabled={locked}
                    error={!item.label.trim()}
                    onChange={e => patchItem(index, { label: e.target.value })}
                  />
                  <TextField
                    select size="small" label="Type" sx={{ width: 130 }} value={item.inputType} disabled={locked}
                    onChange={e => patchItem(index, { inputType: e.target.value as CompetencyInputType })}
                  >
                    <MenuItem value="rating">Rated</MenuItem>
                    <MenuItem value="text">Free text</MenuItem>
                  </TextField>
                  {item.inputType === 'rating' && (
                    <TextField
                      size="small" type="number" label="Weight" sx={{ width: 100 }}
                      value={item.weight} disabled={locked}
                      inputProps={{ min: 0, step: 1 }}
                      onChange={e => patchItem(index, { weight: Number(e.target.value) })}
                    />
                  )}
                </Stack>
                <TextField
                  size="small" fullWidth label="Guidance for the lead (optional)" value={item.description}
                  disabled={locked}
                  onChange={e => patchItem(index, { description: e.target.value })}
                />
                <FormControlLabel
                  control={
                    <Switch size="small" checked={item.isRequired} disabled={locked}
                      onChange={e => patchItem(index, { isRequired: e.target.checked })} />
                  }
                  label={<Typography sx={{ fontSize: 12 }}>Required</Typography>}
                />
              </Stack>

              <IconButton
                size="small" color="error" disabled={locked || items.length === 1}
                onClick={() => { setItems(prev => prev.filter((_, i) => i !== index)); setDirty(true); }}
              >
                <DeleteOutlineRounded fontSize="inherit" />
              </IconButton>
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Button
        size="small" startIcon={<AddRounded />} sx={{ mt: 1.5 }} disabled={locked}
        onClick={() => { setItems(prev => [...prev, { ...BLANK_ITEM }]); setDirty(true); }}
      >
        Add competency
      </Button>

      <Divider sx={{ my: 2.5 }} />

      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button
          variant="contained" size="small" disabled={!canSave || !dirty || locked || saveTemplate.isPending}
          sx={{ bgcolor: NAVY, '&:hover': { bgcolor: '#001f3d' } }}
          onClick={onSave}
        >
          {selectedId ? 'Save template' : 'Create template'}
        </Button>
        {dirty && !locked && <Typography sx={{ fontSize: 12, color: '#ff9800' }}>Unsaved changes</Typography>}
        {saveTemplate.isError && (
          <Typography sx={{ fontSize: 12, color: '#b71c1c' }}>
            {(saveTemplate.error as any)?.response?.data?.message ?? 'Could not save.'}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

export default CompetencyTemplateEditor;

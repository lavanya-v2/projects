import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Link, MenuItem, Paper,
  Radio, RadioGroup, FormControlLabel, Stack, Step, StepLabel, Stepper, TextField, Typography,
} from '@mui/material';
import { ArrowBackRounded, ArrowForwardRounded, CheckCircleRounded } from '@mui/icons-material';
import { useAccount } from '../../../context/UseAccount';
import { useActiveAccountProjects } from '../../../shared/hooks/useActiveAccountProjects';
import { client } from '../../../api/client';
import {
  useReviewConfig, useSaveReviewConfig, useProjectSettings, useSaveProjectSettings,
  useTemplates, usePreviewCycles, useGenerateCycles, useTransitionCycle,
} from '../hooks';
import { IdentityLinkPage } from './IdentityLinkPage';
import type { ReviewCadence, ReviewCycle } from '../types';

const NAVY = '#002e5b';
const INDIGO = '#4f46e5';
const ACCOUNT_DEFAULT = 'account-default';

const STEPS = ['Project', 'Cadence', 'Team members', 'Reviewer', 'Template', 'Launch', 'Done'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Bring one project onto Performance Review, one step at a time.
 *
 * A guided flow, not a permanent screen — entered via "+ Add a project" and
 * exited back to the Review Cycles list once a period is open. Every step
 * reuses an existing screen/hook rather than re-implementing it (see the
 * mapping table in the Phase 10 plan): cadence is `AccountSettingsPage`'s own
 * form shown read-only once the account already has one, team members is
 * `IdentityLinkPage` embedded as-is, template is the existing template
 * library, launch is the existing preview/generate/open sequence.
 */
export function SetupWizardPage({
  selectedProjectId,
  onSelectProject,
  onDone,
}: {
  selectedProjectId: number | null;
  onSelectProject: (projectId: number | null) => void;
  onDone: () => void;
}) {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? null;
  const { jiraProjects, loading: projectsLoading } = useActiveAccountProjects();
  const [step, setStep] = useState(0);

  const { data: configData } = useReviewConfig(accountId);
  const saveConfig = useSaveReviewConfig();
  const { data: settings } = useProjectSettings(selectedProjectId);
  const saveSettings = useSaveProjectSettings();
  const { data: templates = [] } = useTemplates(accountId ?? undefined);
  const activeTemplates = useMemo(() => templates.filter(t => t.status === 'active'), [templates]);
  const generate = useGenerateCycles();
  const transition = useTransitionCycle();

  const accountHasCadence = !!configData?.config?.anchorDate;
  const scope = configData?.config?.scopeProjectIds ?? [];
  const inScope = selectedProjectId ? scope.includes(selectedProjectId) : false;

  const [cadence, setCadence] = useState<ReviewCadence>('monthly');
  const [anchorDate, setAnchorDate] = useState('');
  const [fyStartMonth, setFyStartMonth] = useState(4);
  const [cadenceDirty, setCadenceDirty] = useState(false);

  const [templateChoice, setTemplateChoice] = useState<string>(ACCOUNT_DEFAULT);
  const [reviewerChoice, setReviewerChoice] = useState<number | null>(null);
  const [launchedCycleId, setLaunchedCycleId] = useState<number | null>(null);
  const [targetStart, setTargetStart] = useState<string | null>(null);

  const project = jiraProjects.find(p => p.id === selectedProjectId);
  const selectedDataHealth = configData?.rollout.find(r => r.projectId === selectedProjectId)?.dataHealth ?? null;

  const goNext = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setStep(s => Math.max(s - 1, 0));

  const saveCadence = (onSuccess: () => void) => {
    if (!accountId) return;
    saveConfig.mutate({
      accountId,
      config: {
        cadence, anchorDate, reviewYearStartMonth: fyStartMonth,
        weightSystem: configData?.config?.weightSystem ?? 60,
        weightLead: configData?.config?.weightLead ?? 40,
        weightCustomer: 0,
        isEnabled: true,
      },
    }, { onSuccess });
  };

  const addToScope = (onSuccess: () => void) => {
    if (!accountId || !selectedProjectId) return;
    if (inScope) return onSuccess();
    saveConfig.mutate(
      { accountId, config: { scopeProjectIds: [...scope, selectedProjectId] } },
      { onSuccess },
    );
  };

  const saveReviewer = (onSuccess: () => void) => {
    if (!selectedProjectId) return onSuccess();
    saveSettings.mutate(
      { projectId: selectedProjectId, templateId: settings?.templateId ?? null, defaultReviewerUserId: reviewerChoice },
      { onSuccess },
    );
  };

  const saveTemplate = (onSuccess: () => void) => {
    if (!selectedProjectId) return onSuccess();
    const templateId = templateChoice === ACCOUNT_DEFAULT ? null : Number(templateChoice);
    saveSettings.mutate({ projectId: selectedProjectId, templateId }, { onSuccess });
  };

  const effectiveAnchorDate = accountHasCadence
    ? String(configData!.config!.anchorDate).slice(0, 10)
    : anchorDate;
  const effectiveFyStartMonth = accountHasCadence
    ? configData!.config!.reviewYearStartMonth
    : fyStartMonth;

  const fyStart = useMemo(() => {
    if (!effectiveAnchorDate) return null;
    const y = Number(effectiveAnchorDate.slice(0, 4));
    const m = Number(effectiveAnchorDate.slice(5, 7));
    const firstYear = m >= effectiveFyStartMonth ? y : y - 1;
    return `${firstYear}-${String(effectiveFyStartMonth).padStart(2, '0')}-01`;
  }, [effectiveAnchorDate, effectiveFyStartMonth]);

  const { data: preview } = usePreviewCycles(
    accountId, fyStart ?? '',
    effectiveAnchorDate ? `${Number(effectiveAnchorDate.slice(0, 4)) + 1}-03-31` : '',
    step === 5,
  );

  const today = new Date().toISOString().slice(0, 10);
  // Selectable = would become (or already is) a genuinely completed,
  // still-unopened period — a future or already-open/locked/published period
  // stays visible for context but is never a valid launch target.
  const isSelectable = (c: { endDate: string; exists: boolean; status?: string }) =>
    c.endDate <= today && (!c.exists || c.status === 'scheduled');

  // Pre-select the same period the old fixed heuristic would have picked —
  // the common case is still one click — but let the superuser override it
  // before committing, since the chips used to look clickable and weren't.
  const effectiveTargetStart = useMemo(() => {
    if (targetStart) return targetStart;
    const eligible = (preview ?? []).filter(isSelectable);
    return eligible.length > 0 ? eligible[eligible.length - 1].startDate : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, targetStart, today]);

  const doLaunch = () => {
    if (!accountId || !preview || preview.length === 0) return;
    generate.mutate({ accountId, upTo: preview[preview.length - 1].endDate }, {
      onSuccess: async () => {
        if (!effectiveTargetStart) { goNext(); return; }
        const fresh = (await client.get<ReviewCycle[]>('/performance-review/cycles', {
          params: { accountId },
        })).data;
        const target = fresh.find(c => c.startDate === effectiveTargetStart && c.status === 'scheduled');

        if (target) {
          transition.mutate(
            { cycleId: target.id, toStatus: 'open' },
            { onSuccess: () => { setLaunchedCycleId(target.id); goNext(); } },
          );
          return;
        }
        goNext();
      },
    });
  };

  if (!accountId) {
    return <Alert severity="info" sx={{ fontSize: 13 }}>Select an account to set up review cycles.</Alert>;
  }

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY }}>
          Add a project to Performance Review
        </Typography>
        <Button size="small" onClick={onDone}>Exit setup</Button>
      </Stack>

      <Stepper activeStep={step} sx={{ mb: 3 }}>
        {STEPS.map(label => (
          <Step key={label}><StepLabel sx={{ '& .MuiStepLabel-label': { fontSize: 12 } }}>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {step === 0 && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2 }}>
            Pick the project you want to bring onto Performance Review.
          </Typography>
          <TextField
            select size="small" label="Project" sx={{ minWidth: 280 }}
            value={selectedProjectId ?? ''} disabled={projectsLoading}
            onChange={e => onSelectProject(Number(e.target.value))}
          >
            {jiraProjects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
          {selectedDataHealth && !selectedDataHealth.healthy && (
            <Alert severity="warning" sx={{ mt: 2, fontSize: 12.5 }}>
              <strong>Worth a second look before adding this one:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {selectedDataHealth.reasons.map(r => <li key={r}>{r}</li>)}
              </ul>
              You can still continue — this is informational, not a block.
            </Alert>
          )}
        </Paper>
      )}

      {step === 1 && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          {accountHasCadence ? (
            <Alert severity="info" sx={{ fontSize: 13 }}>
              This account reviews on <strong>{configData!.config!.cadence}</strong>, anchored{' '}
              <strong>{String(configData!.config!.anchorDate).slice(0, 10)}</strong> — shared by every
              project in this account's review scope. This project will join that same cadence.
            </Alert>
          ) : (
            <>
              <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2 }}>
                This is the account's shared review cadence — every project added later joins the same
                schedule, so a person working across several projects gets one number, not several out
                of sync with each other.
              </Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <TextField
                  select size="small" label="Cadence" sx={{ minWidth: 160 }} value={cadence}
                  onChange={e => { setCadence(e.target.value as ReviewCadence); setCadenceDirty(true); }}
                >
                  <MenuItem value="monthly">Monthly</MenuItem>
                  <MenuItem value="quarterly">Quarterly</MenuItem>
                </TextField>
                <TextField
                  size="small" type="date" label="Anchor date" sx={{ minWidth: 190 }}
                  InputLabelProps={{ shrink: true }} value={anchorDate}
                  onChange={e => { setAnchorDate(e.target.value); setCadenceDirty(true); }}
                  helperText="Sets the day periods start on"
                />
                <TextField
                  select size="small" label="Financial year starts" sx={{ minWidth: 190 }} value={fyStartMonth}
                  onChange={e => setFyStartMonth(Number(e.target.value))}
                >
                  {MONTHS.map((m, i) => <MenuItem key={m} value={i + 1}>{m}</MenuItem>)}
                </TextField>
              </Stack>
            </>
          )}
          {saveConfig.isError && (
            <Alert severity="error" sx={{ mt: 2, fontSize: 12.5 }}>
              {(saveConfig.error as any)?.response?.data?.message ?? 'Could not save the cadence.'}
            </Alert>
          )}
        </Paper>
      )}

      {step === 2 && selectedProjectId && (
        <>
          <IdentityLinkPage projectId={selectedProjectId} />
          {saveConfig.isError && (
            <Alert severity="error" sx={{ mt: 2, fontSize: 12.5 }}>
              {(saveConfig.error as any)?.response?.data?.message ?? 'Could not add this project to review scope.'}
            </Alert>
          )}
        </>
      )}

      {step === 3 && selectedProjectId && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2 }}>
            This becomes the default reviewer for everyone whose main contribution is this project — a
            per-person override is still available later, from Reviewer Assignment.
          </Typography>
          {(settings?.eligibleReviewers.length ?? 0) === 0 ? (
            <Alert severity="warning" sx={{ fontSize: 13 }}>
              Nobody with lead access to this project yet.{' '}
              <Link href="/admin" underline="hover">Grant access in User Management</Link>, then come back
              to this step.
            </Alert>
          ) : (
            <RadioGroup
              value={reviewerChoice ?? ''}
              onChange={e => setReviewerChoice(Number(e.target.value))}
            >
              {settings!.eligibleReviewers.map(r => (
                <FormControlLabel
                  key={r.id} value={r.id} control={<Radio size="small" />}
                  label={
                    <Typography component="span" sx={{ fontSize: 13, display: 'inline-flex', alignItems: 'center' }}>
                      {r.firstName} {r.lastName}{' '}
                      <Chip size="small" label={r.roleName} sx={{ fontSize: 10, ml: 0.5 }} />
                    </Typography>
                  }
                />
              ))}
            </RadioGroup>
          )}
          {saveSettings.isError && (
            <Alert severity="error" sx={{ mt: 2, fontSize: 12.5 }}>
              {(saveSettings.error as any)?.response?.data?.message ?? 'Could not save the default reviewer.'}
            </Alert>
          )}
        </Paper>
      )}

      {step === 4 && selectedProjectId && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <TextField
            select size="small" label="Competency template for this project" sx={{ minWidth: 320 }}
            value={templateChoice} onChange={e => setTemplateChoice(e.target.value)}
            helperText="Defaults to the account's template. Need a new one? Create it in Competency Templates, then come back to pick it here."
          >
            <MenuItem value={ACCOUNT_DEFAULT}>Account default</MenuItem>
            {activeTemplates.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
          </TextField>
          {saveSettings.isError && (
            <Alert severity="error" sx={{ mt: 2, fontSize: 12.5 }}>
              {(saveSettings.error as any)?.response?.data?.message ?? 'Could not save the template.'}
            </Alert>
          )}
        </Paper>
      )}

      {step === 5 && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 1.5 }}>
            Generating is safe to repeat — it only adds periods that don't exist yet, including history so
            there's a trend from day one. Pick which completed period to open so there's real data to
            review right away — the most recent one is pre-selected.
          </Typography>
          {preview && preview.length > 0 && (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              {preview.map(c => {
                const selectable = isSelectable(c);
                const selected = selectable && c.startDate === effectiveTargetStart;
                return (
                  <Chip
                    key={c.startDate} size="small"
                    label={`${c.periodLabel}${c.exists ? '' : ' +'}`}
                    clickable={selectable}
                    onClick={
                      selectable
                        // Clicking the already-selected chip clears the manual
                        // override rather than being a no-op — falls back to
                        // effectiveTargetStart's auto-picked default, not to
                        // "nothing selected".
                        ? () => setTargetStart(selected ? null : c.startDate)
                        : undefined
                    }
                    variant={selected ? 'filled' : 'outlined'}
                    sx={{
                      fontSize: 11,
                      cursor: selectable ? 'pointer' : 'default',
                      opacity: selectable ? 1 : 0.5,
                      bgcolor: selected ? INDIGO : c.exists ? '#eef2f7' : '#e8f5e9',
                      color: selected ? '#fff' : c.exists ? '#374151' : '#1b5e20',
                      borderColor: selectable ? INDIGO : undefined,
                      fontWeight: selected ? 700 : 400,
                    }}
                  />
                );
              })}
            </Stack>
          )}
          {!effectiveTargetStart && (
            <Alert severity="info" sx={{ mb: 2, fontSize: 12.5 }}>
              No completed period is available to open yet — generating will still create the scheduled
              periods above; you can open one later from Review Cycles once its window ends.
            </Alert>
          )}
          {(generate.isError || transition.isError) && (
            <Alert severity="error" sx={{ mb: 2, fontSize: 12.5 }}>
              {(generate.error as any)?.response?.data?.message ??
                (transition.error as any)?.response?.data?.message ?? 'Could not launch the cycle.'}
            </Alert>
          )}
        </Paper>
      )}

      {step === 6 && (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <CheckCircleRounded sx={{ fontSize: 40, color: '#4caf50', mb: 1 }} />
          <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY, mb: 0.5 }}>
            {project?.name ?? 'This project'} is set up
          </Typography>
          <Typography sx={{ fontSize: 13, color: '#6b7280' }}>
            {launchedCycleId
              ? 'Its first review cycle is open.'
              : 'Cycles have been generated for this account — open one from the Review Cycles list.'}
          </Typography>
        </Paper>
      )}

      <Stack direction="row" spacing={1.5} sx={{ mt: 3 }} alignItems="center">
        {step > 0 && step < 6 && (
          <Button size="small" startIcon={<ArrowBackRounded />} onClick={goBack}>Back</Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {(saveConfig.isPending || saveSettings.isPending || generate.isPending || transition.isPending) && (
          <CircularProgress size={18} />
        )}
        {step === 0 && (
          <Button size="small" variant="contained" endIcon={<ArrowForwardRounded />}
            disabled={!selectedProjectId} sx={{ bgcolor: INDIGO, '&:hover': { bgcolor: '#4338ca' } }}
            onClick={goNext}>
            Continue
          </Button>
        )}
        {step === 1 && (
          <Button size="small" variant="contained" endIcon={<ArrowForwardRounded />}
            disabled={saveConfig.isPending || (!accountHasCadence && !anchorDate)}
            sx={{ bgcolor: INDIGO, '&:hover': { bgcolor: '#4338ca' } }}
            onClick={() => (accountHasCadence || !cadenceDirty ? goNext() : saveCadence(goNext))}>
            Continue
          </Button>
        )}
        {step === 2 && (
          <Button size="small" variant="contained" endIcon={<ArrowForwardRounded />}
            disabled={saveConfig.isPending} sx={{ bgcolor: INDIGO, '&:hover': { bgcolor: '#4338ca' } }}
            onClick={() => addToScope(goNext)}>
            Continue
          </Button>
        )}
        {step === 3 && (
          <Button size="small" variant="contained" endIcon={<ArrowForwardRounded />}
            disabled={saveSettings.isPending} sx={{ bgcolor: INDIGO, '&:hover': { bgcolor: '#4338ca' } }}
            onClick={() => saveReviewer(goNext)}>
            Continue
          </Button>
        )}
        {step === 4 && (
          <Button size="small" variant="contained" endIcon={<ArrowForwardRounded />}
            disabled={saveSettings.isPending} sx={{ bgcolor: INDIGO, '&:hover': { bgcolor: '#4338ca' } }}
            onClick={() => saveTemplate(goNext)}>
            Continue
          </Button>
        )}
        {step === 5 && (
          <Button size="small" variant="contained" endIcon={<ArrowForwardRounded />}
            disabled={generate.isPending || transition.isPending || !preview || preview.length === 0}
            sx={{ bgcolor: INDIGO, '&:hover': { bgcolor: '#4338ca' } }}
            onClick={doLaunch}>
            Generate & launch
          </Button>
        )}
        {step === 6 && (
          <Button size="small" variant="contained" sx={{ bgcolor: NAVY, '&:hover': { bgcolor: '#001f3d' } }}
            onClick={onDone}>
            Go to Review Cycles
          </Button>
        )}
      </Stack>
    </Box>
  );
}

export default SetupWizardPage;

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Alert, LinearProgress,
  Table, TableHead, TableBody, TableRow, TableCell, Chip,
  Radio, RadioGroup, FormControlLabel, Autocomplete,
  TextField,
} from '@mui/material';
import { CloudUpload, Download } from '@mui/icons-material';
import { client } from '../../../api/client';
import { closeOnEscapeOnly, DialogCloseButton } from '../../../shared/components/dialogHelpers';
import dayjs from 'dayjs';
import { DatePicker } from '@mui/x-date-pickers';

// Phase 1 supports sprint-based Excel uploads only. The kanban template stays in
// the backend (template builder, validator) so re-enabling later is a UI revert.
const TEMPLATE = 'scrum' as const;

interface Props {
  open: boolean;
  projectId: number;
  projectName: string;
  dataSourceType?: string;
  estimationType?: 'story_points' | 'hours';
  reportingFrequency?: 'daily' | 'weekly' | 'sprint';
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

type Template = 'scrum' | 'kanban';

interface Coercion { row?: number; column?: string; reason: string; coerced?: unknown; original?: unknown; }
interface ValError { row: number; column?: string; reason: string; }
interface MappingReportEntry {
  field: string;
  label: string;
  mappedHeader?: string;
  usedHeader?: string;
  matched: boolean;
  column?: number;
  source: 'mapping' | 'default' | 'none';
}
/** Sprint identity carried by the file itself, measured before the declared sprint is applied. */
interface SprintCoverage {
  rowsMissingSprint: number;
  rowsWithSprint: number;
  sprintsInFile: { sprintName: string; rows: number }[];
  declaredSprintApplied: boolean;
}

interface Validation {
  ok: boolean;
  mode: 'strict' | 'best_effort';
  template: Template;
  rows: unknown[];
  history: unknown[];
  errors: ValError[];
  coercions: Coercion[];
  mappingReport?: MappingReportEntry[];
  sprintCoverage?: SprintCoverage;
}

interface SprintImpact {
  sprintKey: string;
  sprintName: string;
  existingTickets: number;
  existingStoryPoints: number;
  incomingRows: number;
  updates: number;
  additions: number;
  /** Tickets already stored for this sprint that are absent from the new file. */
  missing: number;
  totalsAfter: {
    merge: { tickets: number; storyPoints: number };
    replace: { tickets: number; storyPoints: number };
  };
}

interface ImpactReport {
  hasCollision: boolean;
  sprints: SprintImpact[];
}

interface DuplicateInfo {
  id: number;
  filename?: string;
  uploadedAt: string;
}

interface PreviewResponse {
  ok: boolean;
  validation: Validation;
  impact?: ImpactReport;
  duplicateOf?: DuplicateInfo | null;
}

// Fields worth warning about when they do not resolve to a column. The rest are genuinely optional
// and their absence is routine, so flagging them would be noise.
const NOTABLE_FIELDS = [
  'externalId',
  'title',
  'status',
  'type',
  'assigneeEmail',
  'storyPoints',
  'sprintName',
  'createdDate',
  'lastUpdated',
];

const columnLetter = (column?: number) => {
  if (!column) return '';
  let n = column;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

const todayIso = () => new Date().toISOString().split('T')[0];

export const ExcelUploadDialog = ({ open, projectId, projectName, dataSourceType, estimationType, reportingFrequency = 'daily', onClose, onSuccess }: Props) => {
  const isHours = estimationType === 'hours';
  const isSprint = reportingFrequency === 'sprint';
  const isWeekly = reportingFrequency === 'weekly';
  // Sprint uploads carry their period in the file's Sprint columns, so no manual date is
  // required. Daily/weekly uploads still tag a single date snapshot.
  const dateLabel = isWeekly ? 'Week Of' : 'Report Date';
  const uploadNoun = isSprint ? 'Sprint' : isWeekly ? 'Weekly' : 'Daily';
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<DuplicateInfo | null>(null);
  const [strategy, setStrategy] = useState<'merge' | 'replace'>('merge');
  const [reportDate, setReportDate] = useState<string>(todayIso());
  const [sprintName, setSprintName] = useState<string>('');
  const [knownSprints, setKnownSprints] = useState<Array<{ id: number; name: string }>>([]);
  const minAllowedDate = dayjs().subtract(90, 'day');

  const hasCollision = !!impact?.hasCollision;

  // Offer the sprints already known to the project so re-uploads land in the same bucket.
  useEffect(() => {
    if (!open || !isSprint) return;
    client
      .get<Array<{ id: number; name: string }>>(`/datasource/projects/${projectId}/sprints`)
      .then(res => setKnownSprints(res.data ?? []))
      .catch(() => setKnownSprints([]));
  }, [open, isSprint, projectId]);

  // The declared sprint feeds validation and the impact diff, so changing it after picking a file
  // must refresh both -- otherwise the panel below would describe a different upload.
  useEffect(() => {
    if (!file || !isSprint) return;
    const timer = setTimeout(() => { doValidate(file); }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintName]);

  const [dateError, setDateError] = useState('');
  const helperText = isWeekly ? "One upload = one week's snapshot. Re-uploading the same week overwrites." : "One upload = one day's snapshot. Re-uploading the same date overwrites."
  const reset = () => {
    setFile(null);
    setValidation(null);
    setImpact(null);
    setDuplicateOf(null);
    setStrategy('merge');
    setError(null);
    setReportDate(todayIso());
    setDateError('');
    setSprintName('');
  };

  const handleDateChange = (date: dayjs.Dayjs | null) => {
    if (!date) {
      setReportDate('');
      setDateError('');
      return;
    }
    if (date.isValid()) {
      setReportDate(date.toISOString());
      if (date.isAfter(dayjs(), 'day')) {
        setDateError('Date cannot be in the future.');
      } else if (date.isBefore(minAllowedDate, 'day')) {
        setDateError('Date not valid.');
      } else {
        setDateError('');
      }
    } else {
      setDateError('');
    }
  };


  // Validation and the impact diff come from one round trip so the user sees column problems and
  // data-overlap consequences together, before anything is written.
  const doValidate = async (f: File) => {
    setBusy(true);
    setError(null);
    setValidation(null);
    setImpact(null);
    setDuplicateOf(null);
    setStrategy('merge');
    try {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      if (!['xlsx', 'csv'].includes(ext)) {
        setError('Only .xlsx and .csv files are supported');
        return;
      }

      const fd = new FormData();
      fd.append('file', f);
      fd.append('template', projectId.toString());
      if (isSprint && sprintName.trim()) {
        fd.append('sprintName', sprintName.trim());
      }
      fd.append('dataSourceType', dataSourceType ?? 'excel');

      const extension = ext === 'csv' ? 'csv' : 'excel';
      const res = await client.post<PreviewResponse>(
        `/datasource/projects/${projectId}/${extension}/imports/preview`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      setValidation(res.data.validation);
      setImpact(res.data.impact ?? null);
      setDuplicateOf(res.data.duplicateOf ?? null);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  const doUpload = async () => {
    if (!file || (!isSprint && !reportDate)) return;

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('template', projectId.toString());
      if (isSprint && sprintName.trim()) {
        fd.append('sprintName', sprintName.trim());
      }
      fd.append('dataSourceType', dataSourceType ?? 'excel');
      // Sprint uploads omit reportDate so no daily DSR job is queued; the sprint period
      // comes from the file. Daily/weekly uploads tag the chosen snapshot date.
      if (!isSprint) {
        fd.append('reportDate', reportDate);
      }
      if (hasCollision) {
        fd.append('conflictStrategy', strategy);
      }
      const extension = ext === 'csv' ? 'csv' : 'excel';
      const endpoint = `/datasource/projects/${projectId}/${extension}/imports`;
      const res = await client.post(endpoint, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.ok) {
        const rows = res.data.validation?.rows?.length ?? 0;
        const queuedMsg = res.data.queuedJobId
          ? ' · DSR generation queued — refresh Daily Reports in a moment'
          : '';
        const forLabel = isSprint ? 'sprint snapshot' : reportDate;
        const how = hasCollision ? ` (${strategy})` : '';
        onSuccess(`Imported ${rows} rows${how} for ${forLabel}${queuedMsg}`);
        reset();
        onClose();
      } else {
        setValidation(res.data?.validation ?? null);
        setError('Upload rejected');
      }
    } catch (e: any) {
      // 409 means the server found an overlap the client had not accounted for.
      if (e.response?.status === 409 && e.response.data?.impact) {
        setImpact(e.response.data.impact);
        setError(e.response.data.error || 'This upload overlaps existing data. Choose Merge or Replace.');
      } else {
        setError(e.response?.data?.error || e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await client.get(`/datasource/excel/template/${TEMPLATE}`, {
        responseType: 'blob',
        params: { estimationType: isHours ? 'hours' : 'story_points' },
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dsr-${TEMPLATE}-${isHours ? 'hours-' : ''}template.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    }
  };

  /*
   * The form sprint is a fallback for rows the file does not cover, so it is only mandatory when
   * such rows exist. Requiring it unconditionally blocked correctly-mapped exports that name a
   * sprint on every row -- the file's own sprints were complete, yet Confirm stayed disabled until
   * a sprint was invented.
   *
   * Default to required until a file has been validated, so the field does not look optional and
   * then turn mandatory once the preview lands.
   */
  const coverage = validation?.sprintCoverage;
  const sprintRequired = isSprint && (coverage ? coverage.rowsMissingSprint > 0 : true);

  const sprintHelperText = (() => {
    if (!coverage) return 'Required for sprint-based projects. Used for rows whose file has no sprint.';
    if (coverage.rowsMissingSprint === 0) {
      const named = coverage.sprintsInFile;
      const preview = named.slice(0, 3).map(s => s.sprintName).join(', ');
      const more = named.length > 3 ? `, +${named.length - 3} more` : '';
      return named.length > 0
        ? `Not needed — this file names a sprint for every row (${preview}${more}).`
        : 'Not needed — this file names a sprint for every row.';
    }
    return `Required — ${coverage.rowsMissingSprint} of ${coverage.rowsMissingSprint + coverage.rowsWithSprint} rows in this file have no sprint.`;
  })();

  const canUpload =
    !!file &&
    validation?.ok === true &&
    (isSprint ? !sprintRequired || !!sprintName.trim() : !!reportDate);

  return (
    <Dialog open={open} onClose={closeOnEscapeOnly(onClose)} fullWidth maxWidth="md">
      <DialogTitle sx={{ pr: 6 }}>
        Upload {uploadNoun} Data — {projectName}
        <DialogCloseButton onClick={() => { reset(); onClose(); }} disabled={busy} />
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="small" startIcon={<Download />} onClick={downloadTemplate}>
            Download Scrum template
          </Button>
          <Typography variant="caption" color="text.secondary">
            Sprint-based template. Fill in tickets, then upload below.
            {isHours && ' Estimates go in the "Estimated Hours" column (hours-based project).'}
          </Typography>
        </Box>

        {isSprint ? (
          <>
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Rows carrying a Sprint value keep it. Pick a sprint below for any row that does not —
              re-uploading the same sprint later merges with what is already stored.
            </Alert>
            {/*
              Sprint identity is declared, not derived from the clock. Previously a file with no
              Sprint column produced "Custom Sprint - <upload time>", minting a fresh sprint on every
              upload so the same sprint could never be re-uploaded.
            */}
            <Autocomplete
              freeSolo
              options={knownSprints.map(s => s.name)}
              value={sprintName}
              onInputChange={(_, v) => setSprintName(v)}
              renderInput={params => (
                <TextField
                  {...params}
                  size="small"
                  label="Sprint"
                  required={sprintRequired}
                  placeholder="Choose an existing sprint or type a new name"
                  helperText={sprintHelperText}
                />
              )}
            />
          </>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, maxWidth: { xs: '100%', sm: 500 } }}>
            <DatePicker
              label={dateLabel} value={dayjs(reportDate)}
              onChange={handleDateChange}
              minDate={minAllowedDate}
              maxDate={dayjs()}
              slotProps={{ textField: { fullWidth: true, helperText: dateError || helperText, error: Boolean(dateError) } }}
            />
          </Box>
        )}

        <Button
          variant="outlined"
          component="label"
          startIcon={<CloudUpload />}
          disabled={busy}
        >
          {file ? file.name : 'Choose a file'}
          <input
            type="file"
            accept=".xlsx,.csv"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                setValidation(null);
                doValidate(f);
              }
            }}
          />
        </Button>

        {busy && <LinearProgress />}
        {error && <Alert severity="error">{error}</Alert>}

        {duplicateOf && (
          <Alert severity="info">
            This looks like the same file you uploaded on{' '}
            {new Date(duplicateOf.uploadedAt).toLocaleString()}
            {duplicateOf.filename ? ` (${duplicateOf.filename})` : ''}. Importing it again is safe — matching
            tickets are updated, not duplicated.
          </Alert>
        )}

        {/*
          Overlap confirmation. Merge cannot double-count: identity is (project, sprint, ticket), so a
          re-uploaded ticket overwrites its own row. The number that actually decides Merge vs Replace
          is "not in this file", so it is always shown -- including when it is zero.
        */}
        {hasCollision && (
          <Box sx={{ border: '1px solid #f0c36d', borderRadius: 1, p: 2, bgcolor: '#fff9ec' }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              This upload overlaps data already imported
            </Typography>

            {impact!.sprints
              .filter(s => s.existingTickets > 0)
              .map(s => (
                <Box key={s.sprintKey} sx={{ mb: 1.5 }}>
                  <Typography variant="body2" fontWeight={600}>{s.sprintName}</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    Already stored: {s.existingTickets} tickets · {s.existingStoryPoints} SP
                  </Typography>
                  <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                    This file has {s.incomingRows} rows for this sprint — {s.updates} update existing
                    tickets, {s.additions} are new.
                  </Typography>
                  <Typography
                    variant="caption"
                    component="div"
                    color={s.missing > 0 ? 'warning.main' : 'text.secondary'}
                    fontWeight={s.missing > 0 ? 600 : 400}
                  >
                    {s.missing} existing {s.missing === 1 ? 'ticket is' : 'tickets are'} not in this file —
                    Merge keeps {s.missing === 1 ? 'it' : 'them'}, Replace deletes {s.missing === 1 ? 'it' : 'them'}.
                  </Typography>
                  <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
                    After Merge: {s.totalsAfter.merge.tickets} tickets / {s.totalsAfter.merge.storyPoints} SP
                    {'   ·   '}
                    After Replace: {s.totalsAfter.replace.tickets} tickets / {s.totalsAfter.replace.storyPoints} SP
                  </Typography>
                </Box>
              ))}

            <RadioGroup value={strategy} onChange={e => setStrategy(e.target.value as 'merge' | 'replace')}>
              <FormControlLabel
                value="merge"
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    <strong>Merge</strong> — update matching tickets, add new ones, keep the rest (recommended)
                  </Typography>
                }
              />
              <FormControlLabel
                value="replace"
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    <strong>Replace</strong> — this file is the full truth for these sprints; anything missing is removed
                  </Typography>
                }
              />
            </RadioGroup>
          </Box>
        )}

        {validation && (
          <Box sx={{ border: '1px solid #e0e4ea', borderRadius: 1, p: 2, bgcolor: '#f8fafc' }}>
            <Typography component="div" variant="body2" fontWeight={600} sx={{ mb: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <span>Validation: {validation.ok ? 'OK' : 'Failed'}</span>
              <Chip
                size="small"
                label={validation.mode === 'strict' ? 'strict' : 'best-effort'}
                color={validation.mode === 'strict' ? 'success' : 'warning'}
              />
              <Chip size="small" label={`${validation.rows.length} rows`} />
              <Chip size="small" label={`${validation.history.length} history entries`} />
              {validation.history.length === 0 && (
                <Chip size="small" label="Lower fidelity" color="warning" />
              )}
            </Typography>

            {/*
              A file can carry several sprints without saying so -- one upload silently became a
              single blended sprint, and its delivery figure was a mix of six iterations. Naming
              them here is informational: the rows still import into the sprints they name.
            */}
            {coverage && coverage.sprintsInFile.length > 1 && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                <strong>This file spans {coverage.sprintsInFile.length} sprints</strong> — they will
                import as separate sprints, each measured on its own.
                <Box component="ul" sx={{ m: 0.5, pl: 2.5 }}>
                  {coverage.sprintsInFile.map(s => (
                    <li key={s.sprintName}>
                      <Typography variant="caption">
                        {s.sprintName} ({s.rows} {s.rows === 1 ? 'row' : 'rows'})
                      </Typography>
                    </li>
                  ))}
                </Box>
              </Alert>
            )}

            {coverage?.declaredSprintApplied && coverage.rowsWithSprint > 0 && (
              <Alert severity="info" sx={{ mb: 1 }}>
                {coverage.rowsMissingSprint} row{coverage.rowsMissingSprint === 1 ? '' : 's'} with no
                sprint of {coverage.rowsMissingSprint === 1 ? 'its' : 'their'} own will be imported as{' '}
                <strong>{sprintName.trim()}</strong>. The other {coverage.rowsWithSprint} keep the
                sprint named in the file.
              </Alert>
            )}

            {validation.mode === 'best_effort' && validation.coercions.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                Best-effort coercions applied. Review before confirming.
              </Alert>
            )}

            {/*
              Column preflight. A mapped column that is not present in the file used to import as a
              silent blank -- the cause of "story points are 0 even though the file has them".
              Surfacing it here means the user sees the reason before any data is written.
            */}
            {!!validation.mappingReport?.length && (() => {
              const report = validation.mappingReport!;
              const notable = report.filter(m => NOTABLE_FIELDS.includes(m.field));
              const missing = notable.filter(m => !m.matched);

              return (
                <Box sx={{ mb: 1 }}>
                  {missing.length > 0 && (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      {missing.length === 1 ? 'A column was' : `${missing.length} columns were`} not
                      found in this file and will import as blank:{' '}
                      <strong>{missing.map(m => m.label).join(', ')}</strong>.
                      {missing.some(m => m.source === 'mapping')
                        ? ' Check the column mapping in Project settings.'
                        : ' Map the matching column in Project settings.'}
                    </Alert>
                  )}
                  <Typography variant="caption" fontWeight={600} sx={{ display: 'block' }}>
                    Column mapping ({notable.filter(m => m.matched).length}/{notable.length} found)
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Field</TableCell>
                        <TableCell>Looked for</TableCell>
                        <TableCell>Found</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {notable.map(m => (
                        <TableRow key={m.field}>
                          <TableCell>{m.label}</TableCell>
                          <TableCell>
                            {m.mappedHeader ?? m.usedHeader ?? m.label}
                            {!m.mappedHeader && (
                              <Typography component="span" variant="caption" color="text.secondary">
                                {' '}(not mapped)
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            {m.matched ? (
                              <Chip size="small" color="success" label={`column ${columnLetter(m.column)}`} />
                            ) : (
                              <Chip size="small" color="warning" label="not found" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              );
            })()}

            {validation.errors.length > 0 && (
              <>
                <Typography variant="caption" fontWeight={600} color="error">
                  Errors ({validation.errors.length})
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Row</TableCell>
                      <TableCell>Column</TableCell>
                      <TableCell>Reason</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {validation.errors.slice(0, 20).map((e, i) => (
                      <TableRow key={i}>
                        <TableCell>{e.row}</TableCell>
                        <TableCell>{e.column || ''}</TableCell>
                        <TableCell>{e.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}

            {validation.coercions.length > 0 && (
              <>
                <Typography variant="caption" fontWeight={600} sx={{ mt: 1, display: 'block' }}>
                  Coercions ({validation.coercions.length})
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Row</TableCell>
                      <TableCell>Column</TableCell>
                      <TableCell>Original</TableCell>
                      <TableCell>Coerced</TableCell>
                      <TableCell>Reason</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {validation.coercions.slice(0, 20).map((c, i) => (
                      <TableRow key={i}>
                        <TableCell>{c.row ?? ''}</TableCell>
                        <TableCell>{c.column || ''}</TableCell>
                        <TableCell>{String(c.original ?? '')}</TableCell>
                        <TableCell>{String(c.coerced ?? '')}</TableCell>
                        <TableCell>{c.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { reset(); onClose(); }}>Cancel</Button>
        <Button variant="contained" onClick={doUpload} disabled={!canUpload || busy || Boolean(dateError) || !reportDate}>
          {hasCollision ? (strategy === 'replace' ? 'Replace sprint data' : 'Merge into existing data') : 'Confirm & Import'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

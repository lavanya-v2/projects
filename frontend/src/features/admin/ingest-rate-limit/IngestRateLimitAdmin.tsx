import { useState } from 'react';
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
  Button,
  TextField,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import {
  useIngestRateLimit,
  useSetGlobalRateLimit,
  useSetTokenOverride,
  useCollectorVersionPolicy,
  useSetCollectorVersionPolicy,
  type RateLimitToken,
} from './hooks';
import { Controller, useForm } from 'react-hook-form'; 
import dayjs from 'dayjs';
import z from 'zod';
import { DatePicker } from '@mui/x-date-pickers';
import { zodResolver } from '@hookform/resolvers/zod';

const NAVY = '#002e5b';
const BORDER = '#e0e4ea';

interface FormInput {
  minVersion: string | null;
  enforceDate?: string | null;
}

const collectorSchema = z.object({
  minVersion: z.string().nullable().refine((value) => {
    if (!value) return true;
    return /^[0-9][0-9.]{0,15}$/.test(value);
  }, { message: "Invalid version" }),
  enforceDate: z
        .string()
        .nullable()
        .optional()
        .refine((value) => {
            if (!value) return true;
            const today = dayjs();
            const dueDate = dayjs(value);
            return dueDate.isAfter(today);
        }, {
            message: "Due date cannot be today or past date",
        })
        .refine((value) => {
            if (!value) return true;
            const today = dayjs();
            const maxDate = today.add(90, 'day');
            const dueDate = dayjs(value);
            return dueDate.isBefore(maxDate);
        }, {
            message: "Due date should be within 90 days from today",
        }),
});

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function OverrideCell({ t }: { t: RateLimitToken }) {
  const setOverride = useSetTokenOverride();
  const [value, setValue] = useState(t.minIntervalMinutesOverride != null ? String(t.minIntervalMinutesOverride) : '');

  return (
    <TableCell>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          size="small"
          type="number"
          placeholder="global default"
          value={value}
          disabled={setOverride.isPending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const next = value.trim() === '' ? null : Number(value);
            if (next !== t.minIntervalMinutesOverride) {
              setOverride.mutate({ tokenId: t.tokenId, minIntervalMinutesOverride: next });
            }
          }}
          sx={{ width: 130, '& input': { fontSize: 12.5 } }}
        />
        {t.minIntervalMinutesOverride != null && (
          <Chip label="override active" size="small" sx={{ bgcolor: '#fff4e5', color: '#b26a00', fontSize: 10.5, fontWeight: 600 }} />
        )}
      </Box>
    </TableCell>
  );
}

const fmtDay = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

/**
 * Fleet-wide minimum collector version, enforced at ingest once `enforceAfter`
 * passes (ADDENDUM 22). This is the structural fix for the 'ungated-collector'
 * Data Quality flag: that flag is a pure version fact (any collector below the
 * one that introduced the VPN gate has no vpnGate field at all), so flagging it
 * forever only works if people choose to update. Setting a date here gives the
 * fleet a real window to update BEFORE anything starts getting rejected.
 */
function VersionPolicyCard() {
  const { data, isLoading, isError } = useCollectorVersionPolicy();
  const setPolicy = useSetCollectorVersionPolicy();

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, isValid },
    control,
  } = useForm<FormInput>({
    values: {
      minVersion: data?.minEnforcedVersion ?? null,
      enforceDate: data?.enforceAfter ? data.enforceAfter.slice(0, 10) : null,
    },
    resolver: zodResolver(collectorSchema),
    mode: 'onChange',
  });
  if (isLoading) return null;
  if (isError || !data) return <Alert severity="error" sx={{ mb: 3, maxWidth: 640 }}>Failed to load collector version policy.</Alert>;

  const active = !!data.minEnforcedVersion && !!data.enforceAfter;
  const enforcementStarted = active && new Date(data.enforceAfter as string).getTime() <= dayjs().startOf('day').toDate().getTime();

  const updateEnforceDate = async (data: FormInput) => {
    setPolicy.mutate({
            minEnforcedVersion: data?.minVersion || null,
            enforceAfter: data?.enforceDate || null,
    })
  }; 

  return (
    <Paper elevation={0} sx={{ p: 2, mb: 3, border: `1px solid ${BORDER}`, borderRadius: 2, maxWidth: 560 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: NAVY, mb: 0.5 }}>Minimum collector version</Typography>
      <Typography sx={{ fontSize: 12, color: '#6b7280', mb: 1.5 }}>
        Reports from a collector below this version are rejected once the effective date has passed —
        not just flagged. Leave both fields empty for no enforcement (today&rsquo;s default).
      </Typography>

      {active && (
        <Alert severity={enforcementStarted ? 'warning' : 'info'} sx={{ mb: 1.5, fontSize: 12.5 }}>
          {enforcementStarted
            ? <>Enforcing now: collectors below <b>{data.minEnforcedVersion}</b> are being rejected.</>
            : <>Enforcement starts <b>{fmtDay(data.enforceAfter)}</b>: collectors below <b>{data.minEnforcedVersion}</b> will be rejected. Until then this is a grace window — old collectors still report, just keep getting flagged.</>}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          label="Minimum version"
          placeholder="e.g. 1.5.2"
          {...register("minVersion" )}
          error={!!errors.minVersion}
          helperText={errors.minVersion?.message || ""}
          sx={{ width: 160 }}
        />
        <Controller
          name="enforceDate"
          control={control}
          render={({ field }) => (
              <DatePicker
                  label="Enforce Date"
                  value={field.value ? dayjs(field.value) : null}
                  onChange={(date) => {
                      field.onChange(
                          date ? date.format('YYYY-MM-DD') : ''
                      );
                  }}
                  slotProps={{
                  textField: {
                    size: 'small',
                    error: !!errors.enforceDate,
                    helperText: errors.enforceDate?.message,
                  }}}
                  minDate={dayjs()}
                  maxDate={dayjs().add(90,'day')} 
                  sx={{ minWidth: 160 }} 
              />
          )}
      />

        <Button
          size="small"
          variant="contained"
          disabled={setPolicy.isPending || !isDirty || !isValid}
          onClick={handleSubmit(updateEnforceDate)}
        >
          Save
        </Button>
        {active && (
          <Button
            size="small"
            disabled={setPolicy.isPending}
            onClick={() => { setPolicy.mutate({ minEnforcedVersion: null, enforceAfter: null }); }}
          >
            Clear
          </Button>
        )}
      </Box>
    </Paper>
  );
}

export function IngestRateLimitAdmin() {
  const { data, isLoading, isError } = useIngestRateLimit();
  const setGlobal = useSetGlobalRateLimit();
  const [globalValue, setGlobalValue] = useState(String(data?.globalMinutes));

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (isError || !data) return <Alert severity="error">Failed to load ingest rate limit settings.</Alert>;

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: NAVY }}>Ingest Rate Limit</Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mt: 0.5, mb: 2, maxWidth: 780 }}>
        The minimum time between accepted Claude usage pushes, per user. This is the{' '}
        <b>server-side, unbypassable</b> floor — a user could edit their own local collector, but
        the server enforces this regardless. The client-side interval (in the collector) is only
        an optimization to avoid unnecessary scans; this is the real control.
      </Typography>

      <Paper elevation={0} sx={{ p: 2, mb: 3, border: `1px solid ${BORDER}`, borderRadius: 2, maxWidth: 480 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: NAVY, mb: 1 }}>Global default</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TextField
            size="small"
            type="number"
            value={globalValue}
            onChange={(e) => setGlobalValue(e.target.value)}
            sx={{ width: 140 }}
            slotProps={{ htmlInput: { min: 1 } }}
          />
          <Typography sx={{ fontSize: 12.5, color: '#6b7280' }}>minutes (1440 = once/day)</Typography>
          <Button
            size="small"
            variant="contained"
            disabled={setGlobal.isPending || !globalValue || Number(globalValue) === data.globalMinutes}
            onClick={() => setGlobal.mutate(Number(globalValue))}
          >
            Save
          </Button>
        </Box>
        <Typography sx={{ fontSize: 11.5, color: '#6b7280', mt: 1 }}>
          Applies to every active token unless it has its own override below.
        </Typography>
      </Paper>

      <VersionPolicyCard />

      <Typography sx={{ fontSize: 13, fontWeight: 600, color: NAVY, mb: 1 }}>
        Per-user overrides ({data.tokens.length} active token{data.tokens.length === 1 ? '' : 's'})
      </Typography>
      <Paper elevation={0} sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {['User', 'Token', 'Last seen', 'Override (minutes)'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 600, fontSize: 12, color: NAVY, bgcolor: '#fafbfc' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.tokens.map((t) => (
                <TableRow key={t.tokenId} hover>
                  <TableCell sx={{ fontSize: 13 }}>
                    {t.name} <Typography component="span" sx={{ fontSize: 11.5, color: '#6b7280' }}>({t.login})</Typography>
                  </TableCell>
                  <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace', color: '#6b7280' }}>…{t.lastFour}</TableCell>
                  <TableCell sx={{ fontSize: 12.5, color: '#6b7280' }}>{fmtDate(t.lastSeenAt)}</TableCell>
                  <OverrideCell t={t} />
                </TableRow>
              ))}
              {!data.tokens.length && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4, color: '#6b7280', fontSize: 13 }}>
                    No active ingest tokens yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}

export default IngestRateLimitAdmin;

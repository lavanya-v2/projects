import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Typography,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  TextField,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import { PALETTE } from './ui';
import {
  useConsentStatus,
  useCollectorToken,
  useGenerateToken,
  useRecordConsent,
  useDisableCollector,
  usePurgeData,
  downloadCollectorZip,
} from './hooks';

export const CONSENT_TEXT =
  'I understand what is collected and consent to sending these anonymous usage numbers to Lens. ' +
  'Consent is recorded with date and version in Lens.';

const YesRow = ({ children }: { children: React.ReactNode }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
    <CheckCircleIcon sx={{ fontSize: 17, color: PALETTE.good, mt: '2px' }} />
    <Typography sx={{ fontSize: 13.5, color: '#374151' }}>{children}</Typography>
  </Box>
);
const NoRow = ({ children }: { children: React.ReactNode }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
    <CancelIcon sx={{ fontSize: 17, color: PALETTE.poor, mt: '2px' }} />
    <Typography sx={{ fontSize: 13.5, color: '#374151' }}>{children}</Typography>
  </Box>
);
const Heading = ({ children }: { children: React.ReactNode }) => (
  <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: PALETTE.ink2, mt: 2.5, mb: 1 }}>
    {children}
  </Typography>
);

export function CollectorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const consentQuery = useConsentStatus();
  const tokenQuery = useCollectorToken();
  const generate = useGenerateToken();
  const recordConsent = useRecordConsent();
  const disable = useDisableCollector();
  const purge = usePurgeData();

  const [checked, setChecked] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(false);
    try {
      await downloadCollectorZip();
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  const consented = consentQuery.data?.consented ?? false;

  const handleEnable = async () => {
    await recordConsent.mutateAsync(CONSENT_TEXT);
    const res = await generate.mutateAsync();
    setNewToken(res.token);
  };

  const copyToken = () => {
    if (newToken) {
      navigator.clipboard?.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const lensOrigin = typeof window !== 'undefined' ? window.location.origin : '<your-lens-url>';
  const installMac = newToken
    ? `curl -fsSL ${lensOrigin}/api/collector/install.sh | bash -s -- --token ${newToken} --url ${lensOrigin}`
    : '';
  const installWin = newToken
    ? `$env:CLCT_TOKEN='${newToken}'; $env:CLCT_URL='${lensOrigin}'; irm ${lensOrigin}/api/collector/install.ps1 | iex`
    : '';
  // Re-run commands for machines set up before the weekday scheduler existed. They
  // carry no token (the installer keeps the existing config.json), so they are safe
  // to paste into a team channel and safe to run twice.
  const upgradeMac = `curl -fsSL ${lensOrigin}/api/collector/install.sh | bash -s -- --url ${lensOrigin}`;
  const upgradeWin = `$env:CLCT_URL='${lensOrigin}'; irm ${lensOrigin}/api/collector/install.ps1 | iex`;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Claude Usage Collector
        <Typography sx={{ fontSize: 13, color: PALETTE.ink2, mt: 0.25 }}>
          How it works, what we can and cannot see, and your choices.
        </Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Heading>What it does</Heading>
        <Typography sx={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
          A small background utility on your machine reads Claude Code's local session logs
          <b> automatically on weekdays</b> (and again after each Claude session), computes{' '}
          <b>anonymous counts</b> (how many prompts, token totals, a prompt-quality score), and
          sends only those numbers to Lens so you get a personal report and coaching tips.
          You never have to run anything yourself, and nothing is sent on weekends.
        </Typography>

        <Heading>What leaves your machine</Heading>
        <YesRow>Counts: prompts, sessions, Good/OK/Poor tallies</YesRow>
        <YesRow>Token totals per model, and category signals (e.g. "% missing context")</YesRow>
        <YesRow>Counts of skills / MCP / tool usage</YesRow>
        <YesRow>Your Claude <b>organization id</b> (which customer license) — read from your account file, never your login tokens</YesRow>

        <Heading>What never leaves your machine</Heading>
        <NoRow>Your prompt text or Claude's replies</NoRow>
        <NoRow>Any code, file paths, repo or project names, branches</NoRow>
        <NoRow>Anything about the customer or their data</NoRow>
        <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, mt: 1, lineHeight: 1.5 }}>
          You use the customer's Claude license, so this boundary is absolute — Lens stores numbers only.
          Weak-prompt examples stay in a local report on your own machine.
        </Typography>

        <Heading>Who sees what</Heading>
        <Typography sx={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
          You see your full report. Your lead sees team quality &amp; adoption trends (your vibe-coding flag
          stays private to you). Admins see org-wide aggregates only.
        </Typography>

        <Heading>A coaching tool, not an audit</Heading>
        <Typography sx={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
          These numbers exist to help you use Claude better — they are <b>not</b> tied to ratings or
          compensation, and the dollar figures are estimates, never a bill. Data is self-reported from your
          machine; Lens rejects impossible values and flags implausible ones for review, but it&rsquo;s a
          nudge, not a judgement.
        </Typography>

        <Heading>Prefer a manual download? (fallback)</Heading>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download collector (.zip)'}
          </Button>
          <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2 }}>
            For locked-down machines. Unzip, then in Terminal: <code>xattr -cr .</code> then{' '}
            <code>node setup.js --token … --url …</code>. The one-line install above is easier.
          </Typography>
        </Box>
        {downloadError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            Download failed. Make sure the collector package is available on the server.
          </Alert>
        )}

        {/* Consent / enable */}
        {consentQuery.isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : newToken ? (
          <Alert severity="success" sx={{ mt: 2.5 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>
              Collection enabled. Copy your token now — it is shown only once.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
              <TextField
                value={newToken}
                size="small"
                fullWidth
                slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } } }}
              />
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyToken}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </Box>
            <Typography sx={{ fontSize: 12, mt: 1.5, color: PALETTE.ink2 }}>
              Then paste <b>one line</b> into your terminal — <b>no admin, no download, no security prompt</b>.
              It installs a weekday schedule <b>plus</b> a session-end hook, then tells you which one is
              live — so you can see it worked rather than take our word for it.
            </Typography>
            <Typography sx={{ fontSize: 11, mt: 1, mb: 0.25, fontWeight: 700 }}>macOS / Linux (Terminal)</Typography>
            <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: 11, bgcolor: '#0d1117', color: '#e6edf3', p: 1.25, borderRadius: 1, overflowX: 'auto', m: 0 }}>
              {installMac}
            </Box>
            <Typography sx={{ fontSize: 11, mt: 1, mb: 0.25, fontWeight: 700 }}>Windows (PowerShell)</Typography>
            <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: 11, bgcolor: '#0d1117', color: '#e6edf3', p: 1.25, borderRadius: 1, overflowX: 'auto', m: 0 }}>
              {installWin}
            </Box>
          </Alert>
        ) : consented ? (
          <Alert severity="info" sx={{ mt: 2.5 }}>
            You have already consented (v{consentQuery.data?.version}). Your token is set up — generate a new
            one only if you need to move machines.
          </Alert>
        ) : (
          <Box sx={{ mt: 2.5, p: 1.5, border: `1px solid ${PALETTE.border}`, borderRadius: 1.5, bgcolor: '#fafbfc' }}>
            <FormControlLabel
              control={<Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />}
              label={
                <Typography sx={{ fontSize: 13 }}>
                  {CONSENT_TEXT} (Consent policy v{consentQuery.data?.currentVersion})
                </Typography>
              }
            />
            <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
              <Button
                variant="contained"
                disabled={!checked || recordConsent.isPending || generate.isPending}
                onClick={handleEnable}
              >
                {recordConsent.isPending || generate.isPending ? 'Enabling…' : 'Enable collection'}
              </Button>
              <Button variant="text" onClick={onClose}>Not now</Button>
            </Box>
          </Box>
        )}

        <Heading>Already set up? Switch on the weekday schedule</Heading>
        <Typography sx={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
          Machines installed earlier only reported when a Claude session ended — so a day with no Claude
          use sent nothing at all. Re-run the line below to add the automatic weekday schedule. It needs
          <b> no token</b> (your existing one is kept), and it is safe to run more than once.
        </Typography>
        <Typography sx={{ fontSize: 11, mt: 1.25, mb: 0.25, fontWeight: 700 }}>macOS / Linux (Terminal)</Typography>
        <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: 11, bgcolor: '#0d1117', color: '#e6edf3', p: 1.25, borderRadius: 1, overflowX: 'auto', m: 0 }}>
          {upgradeMac}
        </Box>
        <Typography sx={{ fontSize: 11, mt: 1, mb: 0.25, fontWeight: 700 }}>Windows (PowerShell)</Typography>
        <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: 11, bgcolor: '#0d1117', color: '#e6edf3', p: 1.25, borderRadius: 1, overflowX: 'auto', m: 0 }}>
          {upgradeWin}
        </Box>
        <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: 1 }}>
          It finishes by printing what is actually driving your reports. Look for{' '}
          <code>tier=scheduler</code>.
        </Typography>

        <Divider sx={{ my: 2.5 }} />

        <Heading>Turn it off / uninstall anytime</Heading>
        <Typography sx={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
          Click <b>Disable</b> below — Lens revokes your token immediately, so the utility can no longer send
          anything (its next attempt fails). Then remove the local job:
        </Typography>
        <Box
          component="pre"
          sx={{ fontFamily: 'monospace', fontSize: 11.5, bgcolor: '#f6f8fa', border: `1px solid ${PALETTE.border}`, p: 1.25, borderRadius: 1, overflowX: 'auto', mt: 1 }}
        >
{`node setup.js --reset      removes the weekday job, the session hook and your local config
node setup.js --status     shows what is currently triggering your reports`}
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5, flexWrap: 'wrap' }}>
          <Button
            color="error"
            variant="outlined"
            disabled={disable.isPending || (!consented && !tokenQuery.data?.exists)}
            onClick={() => disable.mutate()}
          >
            {disable.isPending ? 'Disabling…' : 'Disable & revoke my token'}
          </Button>
          <Button color="inherit" variant="text" disabled={purge.isPending} onClick={() => purge.mutate()}>
            {purge.isSuccess ? 'Data deleted ✓' : purge.isPending ? 'Deleting…' : 'Delete my collected data'}
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

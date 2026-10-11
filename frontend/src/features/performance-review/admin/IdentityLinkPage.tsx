import { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Divider, LinearProgress,
  Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  CheckCircleRounded, AutoFixHighRounded, RefreshRounded, LinkRounded, BlockRounded,
} from '@mui/icons-material';
import {
  useIdentityOverview, useSeedIdentities, useDecideIdentityLink, useBulkConfirm,
  useBackfillIdentities, useCreateIdentityLink,
} from '../hooks';
import type { UnresolvedMember, IdentityCoverage } from '../types';

const NAVY = '#002e5b';
const GREEN = '#4caf50';
const AMBER = '#ff9800';
const RED = '#f44336';

/** Below this a suggestion is never bulk-confirmed — it must be judged by hand. */
const BULK_CONFIRM_FLOOR = 0.9;

const confidenceColor = (c: number) => (c >= 0.9 ? GREEN : c >= 0.7 ? AMBER : RED);

interface IdentityOption {
  sourceKey: string;
  sourceDisplayName: string | null;
  scoreRowCount: number;
}

/**
 * The identity confirmation gate for one project — embedded in Project Setup.
 *
 * Roster-driven: this screen only ever asks about people already on the
 * project's team roster. It resolves FROM the roster OUTWARD to the delivery
 * identity that belongs to each of them — never the other way around. A
 * delivery identity with no roster counterpart (overwhelmingly the customer's
 * own staff, sharing the same Jira instance) is never shown here at all; it
 * only shows up as an informational row count in the coverage banner.
 *
 * Two numbers matter, and they are not the same:
 *   - Linked %  — of roster members this project's data has something to say
 *                 about. Reaches 100 once everyone relevant is resolved.
 *   - Undecided — roster members nobody has judged yet. Informational, not a
 *                 gate — a project can run review cycles regardless; an
 *                 unresolved person is just absent until confirmed.
 */
export function IdentityLinkPage({ projectId }: { projectId: number }) {
  const { data, isLoading, isFetching } = useIdentityOverview(projectId);
  const seed = useSeedIdentities();
  const decide = useDecideIdentityLink();
  const bulkConfirm = useBulkConfirm();
  const backfill = useBackfillIdentities();
  const createLink = useCreateIdentityLink();

  const busy =
    seed.isPending || decide.isPending || bulkConfirm.isPending || backfill.isPending || createLink.isPending;

  const coverage = data?.coverage;
  const unresolved = data?.unresolved ?? [];
  const availableIdentities = data?.availableIdentities ?? [];

  const { autoConfirmable, needsJudgement, noMatch } = useMemo(() => {
    const a: UnresolvedMember[] = [];
    const n: UnresolvedMember[] = [];
    const z: UnresolvedMember[] = [];
    for (const u of unresolved) {
      const top = u.candidates[0];
      if (!top) z.push(u);
      else if (top.confidence >= BULK_CONFIRM_FLOOR) a.push(u);
      else n.push(u);
    }
    return { autoConfirmable: a, needsJudgement: n, noMatch: z };
  }, [unresolved]);

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14, color: NAVY }}>
          Identity Resolution
        </Typography>
        <Button
          size="small" variant="outlined" startIcon={<RefreshRounded />}
          disabled={busy}
          onClick={() => seed.mutate(projectId)}
        >
          Find matches
        </Button>
        {(isFetching || busy) && <CircularProgress size={18} />}
      </Stack>
      <Typography sx={{ fontSize: 12, color: '#6b7280', mb: 2 }}>
        The people already on this project's team roster. Confirm which delivery identity is theirs —
        nothing is scored through an unconfirmed link. Missing someone? Add them under
        <strong> Administration → Team Members</strong> first, then click Find matches.
      </Typography>

      {isLoading && <LinearProgress />}

      {coverage && <CoverageBanner coverage={coverage} />}

      {coverage && (
        <Stack direction="row" spacing={1.5} sx={{ mb: 3 }}>
          <Tooltip title={`Confirms every suggestion at ${BULK_CONFIRM_FLOOR * 100}% confidence or above. Weaker matches are left for you.`}>
            <span>
              <Button
                size="small" variant="contained" startIcon={<AutoFixHighRounded />}
                disabled={busy || autoConfirmable.length === 0}
                sx={{ bgcolor: NAVY, '&:hover': { bgcolor: '#001f3d' } }}
                onClick={() => bulkConfirm.mutate({ projectId })}
              >
                Confirm {autoConfirmable.length} certain
              </Button>
            </span>
          </Tooltip>

          <Tooltip title="Re-apply confirmed links to historical score rows. Safe to run repeatedly.">
            <span>
              <Button
                size="small" variant="text" disabled={busy}
                onClick={() => backfill.mutate(projectId)}
              >
                Backfill history
              </Button>
            </span>
          </Tooltip>
        </Stack>
      )}

      {bulkConfirm.data && (
        <Alert severity="success" sx={{ mb: 2, fontSize: 13 }} onClose={() => bulkConfirm.reset()}>
          Confirmed {bulkConfirm.data.confirmed}
          {bulkConfirm.data.propagatedToProjects > 0 &&
            ` — and resolved the same people across ${bulkConfirm.data.propagatedToProjects} other project(s) in this account`}
          {bulkConfirm.data.skipped > 0 && `. ${bulkConfirm.data.skipped} left for you to judge.`}
        </Alert>
      )}
      {seed.data && (
        <Alert severity="info" sx={{ mb: 2, fontSize: 13 }} onClose={() => seed.reset()}>
          {seed.data.created} new suggestion(s), {seed.data.refreshed} refreshed,
          {' '}{seed.data.unmatched} team member(s) with no automatic match.
        </Alert>
      )}

      {!isLoading && unresolved.length === 0 && (
        <Alert severity="success" icon={<CheckCircleRounded />} sx={{ fontSize: 13 }}>
          Every roster member this project's data can speak to has been decided.
        </Alert>
      )}

      {needsJudgement.length > 0 && (
        <IdentitySection
          title="Needs your judgement"
          caption="Matched only by name similarity. Confirm only if you know it is the same person."
          items={needsJudgement} projectId={projectId} availableIdentities={availableIdentities}
          busy={busy} onDecide={decide.mutate} onCreate={createLink.mutate}
        />
      )}
      {noMatch.length > 0 && (
        <IdentitySection
          title="No automatic match"
          caption="Nothing in this project's delivery data looks like this person. Pick their identity by hand, or leave for later if they haven't synced yet."
          items={noMatch} projectId={projectId} availableIdentities={availableIdentities}
          busy={busy} onDecide={decide.mutate} onCreate={createLink.mutate}
        />
      )}
      {autoConfirmable.length > 0 && (
        <IdentitySection
          title="Confident matches"
          caption="Exact login, email or name. Use Confirm certain above to accept them all at once."
          items={autoConfirmable} projectId={projectId} availableIdentities={availableIdentities}
          busy={busy} onDecide={decide.mutate} onCreate={createLink.mutate}
        />
      )}
    </Box>
  );
}

function CoverageBanner({ coverage }: { coverage: IdentityCoverage }) {
  const ready = coverage.undecidedKeyCount === 0 && coverage.linkedPct === 100;
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2.5, borderColor: ready ? GREEN : '#e0e4ea' }}>
      <Stack direction="row" spacing={4} alignItems="center" flexWrap="wrap" useFlexGap>
        <Stat
          label="Undecided" value={String(coverage.undecidedKeyCount)}
          color={coverage.undecidedKeyCount === 0 ? GREEN : AMBER}
          hint="Roster members nobody has judged yet. They're simply absent from scoring until confirmed — this doesn't block the project."
        />
        <Divider orientation="vertical" flexItem />
        <Stat
          label="Resolved" value={`${coverage.linkedPct}%`}
          color={coverage.linkedPct === 100 ? GREEN : AMBER}
          hint={`${coverage.resolvedMembers} of ${coverage.totalRosterMembers} team members this project's data has something to say about.`}
        />
        <Divider orientation="vertical" flexItem />
        <Stat label="Team members" value={String(coverage.totalRosterMembers)} color="#6b7280"
          hint="Roster members with delivery data (or a pending suggestion) in this project." />
        <Divider orientation="vertical" flexItem />
        <Stat
          label="Not on roster" value={String(coverage.nonRosterRowCount)} color="#6b7280"
          hint={`Score rows belonging to a delivery identity with no roster counterpart — usually client-side staff. Informational only, out of ${coverage.totalScoreRows} total rows.`}
        />

        <Box sx={{ flexGrow: 1 }} />
        <Chip
          size="small" icon={ready ? <CheckCircleRounded /> : undefined}
          label={ready ? 'Fully resolved' : 'Some pending'}
          sx={{
            fontWeight: 600, fontSize: 12,
            bgcolor: ready ? '#e8f5e9' : '#fff4e5',
            color: ready ? '#1b5e20' : '#8a5300',
          }}
        />
      </Stack>
      {coverage.staleLinkCount > 0 && (
        <Typography sx={{ fontSize: 12, color: '#8a5300', mt: 1.5 }}>
          {coverage.staleLinkCount} confirmed link(s) no longer appear in delivery data — usually someone who left.
        </Typography>
      )}
    </Paper>
  );
}

function Stat({ label, value, color, hint }: { label: string; value: string; color: string; hint: string }) {
  return (
    <Tooltip title={hint}>
      <Box>
        <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</Typography>
      </Box>
    </Tooltip>
  );
}

interface SectionProps {
  title: string;
  caption: string;
  items: UnresolvedMember[];
  projectId: number;
  availableIdentities: IdentityOption[];
  busy: boolean;
  onDecide: (a: { linkId: number; decision: 'confirm' | 'reject' }) => void;
  onCreate: (a: { projectId: number; teamMemberId: number; sourceKey: string; sourceDisplayName?: string | null }) => void;
}

function IdentitySection({ title, caption, items, projectId, availableIdentities, busy, onDecide, onCreate }: SectionProps) {
  return (
    <Box sx={{ mb: 3.5 }}>
      <Typography sx={{ fontWeight: 600, fontSize: 14, color: NAVY }}>
        {title} <Typography component="span" sx={{ fontSize: 13, color: '#6b7280' }}>({items.length})</Typography>
      </Typography>
      <Typography sx={{ fontSize: 12, color: '#6b7280', mb: 1.25 }}>{caption}</Typography>

      <Stack spacing={1}>
        {items.map(item => (
          <MemberRow
            key={item.teamMemberId} item={item} projectId={projectId}
            availableIdentities={availableIdentities} busy={busy} onDecide={onDecide} onCreate={onCreate}
          />
        ))}
      </Stack>
    </Box>
  );
}

function MemberRow({
  item, projectId, availableIdentities, busy, onDecide, onCreate,
}: {
  item: UnresolvedMember;
  projectId: number;
  availableIdentities: IdentityOption[];
  busy: boolean;
  onDecide: SectionProps['onDecide'];
  onCreate: SectionProps['onCreate'];
}) {
  const top = item.candidates[0];
  // Default the picker to the best suggestion so confirming the common case is
  // one click, while still allowing a search across every identity this
  // project has ever seen.
  const [selected, setSelected] = useState<IdentityOption | null>(
    top ? availableIdentities.find(i => i.sourceKey === top.sourceKey) ?? {
      sourceKey: top.sourceKey, sourceDisplayName: top.sourceDisplayName, scoreRowCount: top.scoreRowCount,
    } : null,
  );

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <Box sx={{ minWidth: 200 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{item.teamMemberName}</Typography>
          <Typography sx={{ fontSize: 11, color: '#9ca3af' }}>{item.email}</Typography>
        </Box>

        {top ? (
          <Chip
            size="small" label={`${Math.round(top.confidence * 100)}%`}
            sx={{ fontWeight: 700, fontSize: 11, color: '#fff', bgcolor: confidenceColor(top.confidence) }}
          />
        ) : (
          <Chip size="small" label="no match" sx={{ fontSize: 11 }} />
        )}

        <Autocomplete
          size="small" sx={{ minWidth: 260 }} disabled={busy}
          options={availableIdentities} value={selected} onChange={(_, v) => setSelected(v)}
          getOptionLabel={(i: IdentityOption) => i.sourceDisplayName || '(no display name)'}
          isOptionEqualToValue={(a: IdentityOption, b: IdentityOption) => a.sourceKey === b.sourceKey}
          renderOption={(props, option) => (
            <li {...props} key={option.sourceKey}>
              <Box>
                <Typography sx={{ fontSize: 13 }}>{option.sourceDisplayName || '(no display name)'}</Typography>
                <Typography sx={{ fontSize: 11, color: '#9ca3af' }}>
                  {option.scoreRowCount} score row{option.scoreRowCount === 1 ? '' : 's'}
                </Typography>
              </Box>
            </li>
          )}
          renderInput={params => <TextField {...params} label="Delivery identity" />}
        />

        <Tooltip title={top?.rationale ?? 'Nothing in the delivery data resembles this person'}>
          <Typography sx={{ fontSize: 11, color: '#6b7280', maxWidth: 200 }} noWrap>
            {top?.rationale ?? '—'}
          </Typography>
        </Tooltip>

        <Box sx={{ flexGrow: 1 }} />

        <Button
          size="small" variant="contained" startIcon={<LinkRounded />}
          disabled={busy || !selected}
          sx={{ bgcolor: NAVY, '&:hover': { bgcolor: '#001f3d' } }}
          onClick={() =>
            selected && onCreate({
              projectId, teamMemberId: item.teamMemberId,
              sourceKey: selected.sourceKey, sourceDisplayName: selected.sourceDisplayName,
            })
          }
        >
          Confirm
        </Button>
        {item.linkId && (
          <Tooltip title="Dismiss this suggestion as the wrong identity for this person">
            <Button
              size="small" color="warning" startIcon={<BlockRounded />} disabled={busy}
              onClick={() => onDecide({ linkId: item.linkId!, decision: 'reject' })}
            >
              Wrong match
            </Button>
          </Tooltip>
        )}
      </Stack>
    </Paper>
  );
}

export default IdentityLinkPage;

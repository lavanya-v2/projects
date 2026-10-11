import { Box, Paper, Typography, Divider } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useAuth } from '../auth/AuthContext';
import { PALETTE, CardTitle } from './ui';

/**
 * A one-page orientation for the Claude Usage section — NOT a metric-by-metric
 * reference. Every number already has an ⓘ tooltip (glossary.ts); this page
 * exists because there was nowhere that explained the SHAPE of the whole
 * thing — what it's for, how the pieces group, and what's different between
 * what a member sees and what their lead sees. Keep additions here short:
 * point at the ⓘ icons for exactness rather than re-explaining a metric.
 *
 * Its own sidebar entry (see navigation.tsx), below My Claude Report and Team
 * Prompt Coaching, under the same pilot gate as My Claude Report.
 */

const LEAD_ROLES = new Set(['superuser', 'admin', 'manager', 'lead']);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper elevation={0} sx={{ p: 2.5, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
      <CardTitle>{title}</CardTitle>
      {children}
    </Paper>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 14, color: '#374151', lineHeight: 1.7, mb: 1.5, '&:last-child': { mb: 0 } }}>
      {children}
    </Typography>
  );
}

export function ClaudeUsageGuide() {
  const { user } = useAuth();
  const isLead = !!user?.roleName && LEAD_ROLES.has(user.roleName);

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Typography sx={{ fontSize: 13.5, color: PALETTE.ink2, mb: 2.5, lineHeight: 1.6 }}>
        A quick guide to what these numbers mean and how to act on them. This section is{' '}
        <b>coaching, not a scorecard</b> — nothing here feeds a review or a rating.
      </Typography>

      <Paper
        elevation={0}
        sx={{ p: 2.5, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderLeft: `3px solid ${PALETTE.navy}`, borderRadius: 2, bgcolor: '#f7f9fc' }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: PALETTE.navy, mb: 1 }}>The short version</Typography>
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          <Typography component="li" sx={{ fontSize: 14, color: '#374151', mb: 0.75, lineHeight: 1.6 }}>
            These numbers are for coaching — never for ranking people or feeding a review.
          </Typography>
          <Typography component="li" sx={{ fontSize: 14, color: '#374151', mb: 0.75, lineHeight: 1.6 }}>
            Compare yourself against <b>your own trend over time</b>, not against other people.
          </Typography>
          <Typography component="li" sx={{ fontSize: 14, color: '#374151', lineHeight: 1.6 }}>
            A flag or a low number means <b>&ldquo;worth a look,&rdquo;</b> not &ldquo;something&rsquo;s wrong.&rdquo;
          </Typography>
        </Box>
      </Paper>

      <Section title="Reading your own report">
        <P>
          <b>Quality</b> — Avg score, the Good/OK/Poor mix, and the signals that explain a low score all measure
          how clearly you prompt, not how much you work. The <b>skill-tier chip</b> at the top (&ldquo;Strong
          practice&rdquo;, etc.) is a <b>different, separate number</b> from Avg score — it blends your score
          with three other habits, so the two are expected to disagree, sometimes by a lot. That&rsquo;s by
          design, not a bug.
        </P>
        <P>
          <b>Habits &amp; capabilities</b> — Skills, MCP, plan mode, subagents and the rest show which
          high-leverage features you&rsquo;re reaching for. A zero here is a &ldquo;try this,&rdquo; never a
          mark against you.
        </P>
        <P>
          <b>Where your tokens go</b> (Details tab) — caching, context loss, session shape, parallel work, pace,
          and model fit are about <b>waste</b>, not effort. None of it affects your score or skill tier — it
          exists purely so you can see where cost piles up without anything to show for it.
        </P>
        <P>
          Hover the ⓘ next to any number for its exact definition and how to move it.
        </P>
      </Section>

      <Section title="Where your tokens go, explained">
        <P>
          Everything in this section comes from your own local session logs — timestamps and token counts, never
          prompt or answer text. The collector on your laptop reduces it to the counts below before anything is
          sent anywhere.
        </P>

        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: PALETTE.navy, mt: 2, mb: 0.5 }}>
          Prompt caching
        </Typography>
        <P>
          Claude re-reads your whole conversation on every turn. If the start of that conversation hasn&rsquo;t
          changed, it can be served from a cache at a fraction of the price instead of being processed fresh.
          The <b>cache hit rate</b> is what share of that re-reading landed in cache. We call it &ldquo;healthy&rdquo;
          at 85%+, &ldquo;partial&rdquo; from 60&ndash;85%, and &ldquo;worth a look&rdquo; below that. It drops
          when sessions get restarted often — a new session has nothing cached yet, so it pays full price to
          load context back in. <b>What helps:</b> keep working in the same session for a task instead of
          starting a new one for every small step.
        </P>

        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: PALETTE.navy, mt: 2, mb: 0.5 }}>
          Context loss
        </Typography>
        <P>
          Every session has a limited context window. Once a conversation outgrows it, Claude Code compacts it —
          most of the history is summarised and thrown away so the session can continue, and everything dropped
          has to be re-established if it&rsquo;s needed again. We count how many times this happened, split into
          <b> automatic</b> (it ran out of room mid-task — this is the number worth acting on) versus
          <b> manual</b> (you triggered it yourself, deliberately, which is fine). <b>What helps:</b> one session
          per task. A session that has already absorbed several unrelated tasks is the one that runs out during
          the next one.
        </P>

        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: PALETTE.navy, mt: 2, mb: 0.5 }}>
          Session shape
        </Typography>
        <P>
          For every session, we count how many prompts it carried before you moved on, and bucket sessions into
          1&ndash;5, 6&ndash;20, 21&ndash;100, and 100+ prompts. A session that ends within five prompts paid full
          price to load context and then discarded it almost immediately — that&rsquo;s the same waste the cache
          number above is picking up, just seen from the session side. A healthy spread is fat in the middle:
          heavy on the short end means restarting too often, heavy on the long end means sessions that will
          eventually hit the context-loss case above.
        </P>

        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: PALETTE.navy, mt: 2, mb: 0.5 }}>
          Parallel work
        </Typography>
        <P>
          If you have more than one Claude session open at a time, we track how many overlap and how often a
          prompt lands in a different session than your last one (a &ldquo;switch&rdquo;). This is <b>not</b> a
          problem by itself — a build running in one window while you work in another is completely normal, and
          it isn&rsquo;t a productivity score either; two people with identical output can sit at either end of
          it. The signal worth noticing is <b>switches within five minutes</b> of each other — that&rsquo;s
          several things being juggled at once, and it tends to line up with vague prompts and rework.
        </P>

        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: PALETTE.navy, mt: 2, mb: 0.5 }}>
          Pace between prompts
        </Typography>
        <P>
          We measure the gap between Claude finishing an answer and your next prompt, bucketed from under 10
          seconds up to over 30 minutes. A prompt inside ten seconds is faster than the previous answer could
          reasonably be read — that&rsquo;s a reflex reply, not a considered one. When a lot of prompts land that
          fast <i>and</i> your rework rate is also high, it usually means the same ground is being re-covered at
          full token cost instead of being fixed once. Slower isn&rsquo;t automatically better — the healthy
          pattern is quick confirmations mixed with real reading gaps, not uniformly slow or uniformly instant.
        </P>

        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: PALETTE.navy, mt: 2, mb: 0.5 }}>
          Model fit
        </Typography>
        <P>
          Each prompt is classified by the kind of work it looks like (debugging, building, refactoring,
          reviewing, explaining) and matched against which model answered it. This is the basis for spotting
          cheaper-model opportunities — e.g. routine explaining or reviewing going to the most expensive model
          when a lighter one would do just as well. Debugging and code generation are the exception: keep those
          on the most capable model, since a cheaper one there usually costs more overall once the retry loop
          runs longer than the saving.
        </P>
      </Section>

      <Section title="If you lead a team">
        {isLead ? (
          <>
            <P>
              Team Prompt Coaching shows the <b>same kind</b> of signal as your own report, aggregated across
              your team, plus a handful of per-member efficiency columns (cache hit, context lost, average
              session size, peak parallel work) so you can see where the team&rsquo;s tokens go as a group.
            </P>
            <P>
              What it deliberately leaves out: a member&rsquo;s <b>vibe-coding index</b> and their <b>AI
              coaching tips</b> stay private to them — you never see either, individually or in aggregate. The
              members table sorts by <b>score</b>, not by any efficiency column, so it isn&rsquo;t an
              efficiency leaderboard. Treat the &ldquo;Focus&rdquo; chip and &ldquo;Team coaching focus&rdquo;
              panel as a starting point for a conversation, not a verdict.
            </P>
          </>
        ) : (
          <P>You&rsquo;ll see this section once you lead a team.</P>
        )}
      </Section>

      <Divider sx={{ my: 2.5 }} />
      <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <LockOutlinedIcon sx={{ fontSize: 15 }} />
        For exactly what data leaves a laptop and who can see what, see &ldquo;How it works &amp; consent&rdquo;
        on My Claude Report.
      </Typography>
    </Box>
  );
}

export default ClaudeUsageGuide;

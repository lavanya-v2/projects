/**
 * Single source of truth for the ⓘ metric explanations shown on every tile and
 * chart. Each entry: what it means, and how to improve it. Keeping this in one
 * place keeps the wording consistent across the member and team views.
 */
export interface GlossaryEntry {
  title: string;
  what: string;
  improve: string;
}

/**
 * Plain-language explainer + a generic, made-up example for each "why prompts lost
 * points" signal — shown on hover in SignalBars. Deliberately illustrative, never a
 * real prompt: raw prompt text never leaves the engineer's machine (see the
 * collector's privacy allowlist), so these examples exist purely to teach the
 * rubric, not to reflect anyone's actual data. Keyed by the same signal keys the
 * backend sends (`SIGNAL_LABELS` in claudeUsageReportService.ts).
 */
export interface SignalExplainer {
  what: string;
  example: string;
}

export const SIGNAL_EXPLAINERS: Record<string, SignalExplainer> = {
  no_context: {
    what: "Doesn't reference a file, error, path, or code snippet. Only what you actually type counts — having a file open or selected in your editor doesn't score as context on its own, since that file is often unrelated to what you're asking.",
    example: '"why is this broken" vs. "why does auth.ts:42 throw a 401"',
  },
  vague: {
    what: 'A catch-all fix/retry with no specifics about what to change.',
    example: '"fix it", "try again", "same error"',
  },
  unclear_referent: {
    what: "Opens with \"this/that/it\" and there's nothing nearby for it to point to.",
    example: '"why does it do that" as the first message in a session',
  },
  rework: {
    what: "A fast, low-effort re-prompt right after a reply — usually means the last answer didn't land.",
    example: 'a 3-word follow-up sent seconds after Claude finishes responding',
  },
  very_short: {
    what: 'Under 3 words — not enough to act on.',
    example: '"fix this"',
  },
  short: {
    what: '4–6 words — a little more to go on, but still thin.',
    example: '"make the tests pass"',
  },
};

export const GLOSSARY: Record<string, GlossaryEntry> = {
  prompts: {
    title: 'Prompts',
    what: "How many messages you sent to Claude in the period (excludes one-word acknowledgements like 'ok'/'thanks').",
    improve: 'Volume is not a target on its own — prompt quality matters more.',
  },
  score: {
    title: 'Average prompt score',
    what: 'A 0–100 quality estimate per prompt, averaged across every scored prompt in range. Points come from specificity, whether you gave context (a file, error, or path YOU TYPED), and whether you had to re-prompt. This is a different number from the "practice" chip at the top of the page — that one blends this score with three other habits (see its own tooltip), so the two will often not match.',
    improve: 'State the goal and paste the relevant code/error/path in your first message. Having a file open or selected in your editor doesn’t count on its own — type or paste what matters.',
  },
  tokens: {
    title: 'Tokens',
    what: 'Total tokens across your Claude turns, split by model and cache tier. A rough measure of how much work went through Claude.',
    improve: "Reuse context and be specific so Claude doesn't re-derive things — fewer wasted tokens.",
  },
  cost: {
    title: 'Estimated cost',
    what: "Your token counts priced by Lens's central rate table. An estimate; rates are maintained in one place by admins.",
    improve: 'Tighter prompts and good use of cached context reduce cost.',
  },
  value: {
    title: 'Value & leverage',
    what: 'On a corporate seat/subscription license there is no per-token charge, so we show the value this usage would cost at API list prices as leverage vs. the seat cost (e.g. 22× = 22 times the seat in value). Token counts are exact; the dollar value and seat price are estimates — never a bill or a customer charge.',
    improve: "It's not a spend target. A low multiple just means the paid-for seat has room to be used more; a high one means great leverage.",
  },
  mix: {
    title: 'Quality mix',
    what: "How your prompts split into Good (≥70), OK (40–69) and Poor (<40). Every prompt starts at 50 points, then gains or loses points for specific things: +15 for giving context (a file, error, or path), −20 for a vague catch-all like 'fix it', −15 for a fast low-effort re-prompt, −10 to −25 for being too short. Hover a bar in \"Why prompts lost points\" below for what each one means, with an example.",
    improve: "Aim to shrink the 'Poor' band week over week — the signals panel below shows exactly which habit to fix first.",
  },
  signals: {
    title: 'Why prompts lost points',
    what: 'The share of your prompts that hit each weakness: no context, rapid re-prompt (rework), very short, vague command, or unclear referent. Hover any bar for what it means and an example.',
    improve: "Tackle your biggest bar first — usually 'no context'.",
  },
  vibe: {
    title: 'Vibe-coding index',
    what: 'How much you rely on unstructured free-text vs. structured help (skills, MCP, tools) — combined with rework and vagueness. Private to you.',
    improve: "Lean on skills/MCP for repetitive work and give context up front to move toward 'structured'.",
  },
  models: {
    title: 'Model usage',
    what: 'Tokens split by the Claude model used across your turns.',
    improve: 'Use lighter models for simple tasks and stronger ones for hard reasoning.',
  },
  capabilities: {
    title: 'Good-practice capabilities',
    what: 'How often you used the high-leverage Claude features — Skills, MCP, Plan mode, Subagents, Task planning, and web research. These are the habits that most lift Claude’s output quality.',
    improve: 'Reach for a skill or MCP for repetitive work, plan before big changes, and let subagents fan out research.',
  },
  capSkills: {
    title: 'Skills',
    what: 'Times you invoked a packaged Skill (a reusable, repo- or task-specific workflow) instead of hand-driving each step.',
    improve: 'When you repeat a multi-step task, wrap it in a skill and invoke it — fewer steps, more consistency.',
  },
  capMcp: {
    title: 'MCP',
    what: 'Calls to MCP tools — connectors that let Claude read from and act on your systems (issue trackers, docs, data) through a safe interface.',
    improve: 'Connect the systems you work in via MCP so Claude works from real data instead of guesses.',
  },
  capPlan: {
    title: 'Plan mode',
    what: 'Turns you spent in plan mode — where Claude thinks through an approach and gets your confirmation before it changes anything. (Older data falls back to counting plan approvals.)',
    improve: 'Use plan mode before non-trivial changes — it catches wrong assumptions before code is written.',
  },
  capAccept: {
    title: 'Accept-edits mode',
    what: 'Turns spent in accept-edits mode, where Claude applies edits without pausing for each approval — useful once you trust the direction.',
    improve: 'Use it for well-scoped, low-risk changes to move faster; stay in plan/normal mode for risky work.',
  },
  capSubagents: {
    title: 'Subagents',
    what: 'Times Claude launched a subagent to parallelise research or scope a large task without cluttering the main thread.',
    improve: 'For broad searches or multi-part work, ask Claude to fan out subagents.',
  },
  capTask: {
    title: 'Task planning',
    what: 'Use of the to-do tool to break work into tracked steps — a strong signal of structured, deliberate work.',
    improve: 'For anything multi-step, have Claude keep a task list so nothing is dropped.',
  },
  capResearch: {
    title: 'Web research',
    what: 'Times Claude grounded its answer in real sources via web search / fetch — the measurable stand-in for retrieval (RAG).',
    improve: 'Ask Claude to verify against current docs/sources when correctness matters.',
  },
  capTools: {
    title: 'Tool calling',
    what: 'Total built-in tool calls (edit, read, run, search, …). An activity measure — how much of the work was tool-driven rather than chat.',
    improve: 'Not a target on its own; higher tool use usually tracks with getting real work done.',
  },
  capAcceptance: {
    title: 'Edit acceptance rate',
    what: 'Share of Claude’s Edit/Write suggestions that were kept vs. undone or rejected. Best-effort — inferred from the tool result, not audited. Shows "—" until enough edits have been made.',
    improve: 'A low rate usually means Claude needs more context up front (files, constraints, examples) before making changes.',
  },
  capMcpServers: {
    title: 'Distinct MCP servers',
    what: 'How many different MCP integrations you drew on (peak in a single day) — never which ones, just the count.',
    improve: 'Connecting more of your systems via MCP tends to reduce back-and-forth and guesswork.',
  },
  promptTypes: {
    title: 'What you use Claude for',
    what: 'Your prompts grouped into categories (debugging, building, refactoring, reviewing, explaining) by their wording — counts only, never the prompt text. "Other" is a catch-all, not a distinct category: it picks up planning/architecture discussion, docs, config/infra work, non-English prompts, and building-style requests that just weren’t phrased in a way the categorizer recognizes.',
    improve: 'No right mix — this is just a mirror of your day-to-day work. A large "Other" share isn’t a problem to fix; it usually just means more of your work is planning/docs/config than the five named categories capture.',
  },
  skillTier: {
    title: 'Skill tier',
    what: 'A single 0–100 practice score blending four signals with different weights: your average prompt score (40%), use of structured help like skills/tools (30%), a low vibe-coding index (20%), and edit-acceptance rate (10%, skipped and the rest rescaled if you don’t have enough edits yet). It is NOT the same number as "Avg score" below — that one is just the first ingredient here, so this will usually sit above or below it, sometimes by a lot.',
    improve: 'Improve the pieces individually (context in prompts, skills/MCP, planning) and this rises with them. Not a ranking against peers.',
  },
  teamScore: {
    title: 'Team average score',
    what: 'The daily average prompt score across team members who reported that day.',
    improve: 'Share good-prompt patterns; small habits compound across the team.',
  },
  adoption: {
    title: 'Skill / MCP adoption',
    what: 'Share of turns that used a tool, skill, or MCP rather than plain free-text.',
    improve: 'Higher adoption strongly correlates with higher scores.',
  },
  // --- Efficiency signals ---------------------------------------------------
  cache: {
    title: 'Prompt caching',
    what: 'Claude re-reads the whole conversation every turn. Cached tokens are billed at roughly a tenth of the input rate — this is the share you get at that lower rate.',
    improve: 'Nothing to configure — caching is automatic. A low rate almost always means sessions are being restarted often, so the cache never gets used.',
  },
  contextLoss: {
    title: 'Context loss',
    what: 'When a conversation outgrows the context window it is compacted: most of the history is dropped and summarised, then re-established at full cost.',
    improve: 'Watch the automatic count, not the manual one. One session per task keeps conversations short enough that it rarely triggers.',
  },
  sessionShape: {
    title: 'Session shape',
    what: 'How much work each session carried before you started a new one.',
    improve: 'Lots of very short sessions means context is loaded and thrown away repeatedly. Keep one session open for a whole task.',
  },
  parallelWork: {
    title: 'Parallel work',
    what: 'How many conversations were open at the same time, and how often you switched between them.',
    improve: 'Not a target to drive down — running a build in one window while working in another is normal. Rapid switching is the part worth noticing.',
  },
  pace: {
    title: 'Pace between prompts',
    what: 'How long you left between Claude finishing and your next prompt.',
    improve: 'A large share under ten seconds usually means reflex replies rather than read-then-respond. Compare it with your rework rate.',
  },
  modelFit: {
    title: 'Model fit',
    what: 'Which model answered which kind of work, and what each cost.',
    improve: 'Read-only work (explain, review) rarely needs the most capable model. Keep code generation and debugging on it — a longer retry loop costs more than the saving.',
  },
};

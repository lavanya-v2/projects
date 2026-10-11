import ExcelJS from 'exceljs';
import { performanceSyncService } from './performanceSyncService';

type Health = 'green' | 'amber' | 'red';
type Trend = 'up' | 'down' | 'neutral';

interface MetricSummary {
    current: number | null;
    avg: number | null;
    trend: Trend;
    trendPct: number;
    health: Health;
}

interface TrendSprint {
    syncId: number;
    sprintName: string;
    startDate: string;
    endDate: string;
    productivity: number;
    defectDensity: number;
    reopenRatio: number;
}

export interface MergedProjectTrends {
    projectId: number;
    projectName: string;
    accountName: string;
    // metricKind mirrors performanceSyncService.getProductivityOverview: 'throughput'
    // for Kanban (current/avg/sprint values are SP completed per span, not a
    // percentage of a committed target -- Kanban has no commitment to measure
    // against). Only productivity varies this way; defect density and reopen
    // ratio are already the same unit for every delivery model.
    productivity: { sprints: TrendSprint[]; summary: MetricSummary; metricKind: 'percent' | 'throughput' };
    defectDensity: { sprints: TrendSprint[]; summary: MetricSummary };
    reopenRatio: { sprints: TrendSprint[]; summary: MetricSummary };
}

const HEALTH_LABELS: Record<Health, string> = { green: 'Healthy', amber: 'Needs Attention', red: 'At Risk' };
const TREND_LABELS: Record<Trend, string> = { up: 'Up', down: 'Down', neutral: 'Flat' };
const HEALTH_COLOR: Record<Health, string> = { green: '#4caf50', amber: '#ff9800', red: '#f44336' };
const HEALTH_FILL: Record<Health, string> = { green: 'FFE8F5E9', amber: 'FFFFF8E1', red: 'FFFFEBEE' };
const TREND_FILL: Record<Trend, string> = { up: 'FFE8F5E9', down: 'FFFFEBEE', neutral: 'FFF5F5F5' };

const METRICS = [
    { key: 'productivity' as const, label: 'Productivity', unit: '%', decimals: 1 },
    { key: 'defectDensity' as const, label: 'Defect Density', unit: '', decimals: 2 },
    { key: 'reopenRatio' as const, label: 'Reopen Ratio', unit: '%', decimals: 1 },
];

/** Fetches and merges productivity + quality trends for an account, optionally narrowed to one project. */
export async function getMergedTrendsData(accountId: number, projectId?: number): Promise<MergedProjectTrends[]> {
    const [prodOverview, qualityOverview] = await Promise.all([
        performanceSyncService.getProductivityOverview(false, accountId),
        performanceSyncService.getQualityTrendsOverview(false, accountId),
    ]);

    const prodByProjectId = new Map(prodOverview.projects.map(p => [p.projectId, p]));

    let byProject: MergedProjectTrends[] = qualityOverview.projects.map(qp => {
        const pp = prodByProjectId.get(qp.projectId);
        return {
            projectId: qp.projectId,
            projectName: qp.projectName,
            accountName: qp.accountName,
            productivity: pp
                ? {
                    sprints: pp.sprints as any,
                    summary: { current: pp.currentProductivity, avg: pp.avgProductivity, trend: pp.trend, trendPct: pp.trendPct, health: pp.health },
                    metricKind: pp.metricKind,
                }
                : { sprints: qp.sprints as any, summary: qp.productivity, metricKind: 'percent' },
            defectDensity: { sprints: qp.sprints as any, summary: qp.defectDensity },
            reopenRatio: { sprints: qp.sprints as any, summary: qp.reopenRatio },
        };
    });

    if (projectId) {
        byProject = byProject.filter(p => p.projectId === projectId);
    }

    return byProject;
}

function shortSprintName(name: string): string {
    return (name || '').replace(/^Sprint\s*/i, 'S').slice(-14);
}

// `valueKey` overrides which property on the sprint carries the value to plot --
// Kanban productivity plots `spDone` (SP completed, matching the live UI's own
// bars), everything else plots the metric's own key. Without this the export's
// bars/table showed spDone/spPlanned as a PERCENTAGE for Kanban projects while
// the summary line above them showed the current span's raw SP -- two different
// numbers, both labelled the metric's fixed unit, on the same block.
function valueOf(metricKey: typeof METRICS[number]['key'], sprint: TrendSprint, valueKey?: string): number {
    return (sprint as any)[valueKey ?? metricKey] ?? 0;
}

function renderBarChart(sprintsOldestFirst: TrendSprint[], metricKey: typeof METRICS[number]['key'], avg: number | null, decimals: number, unit: string, valueKey?: string): string {
    const w = 520, h = 220, padL = 40, padB = 40, padT = 16, padR = 16;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const values = sprintsOldestFirst.map(s => valueOf(metricKey, s, valueKey));
    const maxVal = Math.max(...values, avg ?? 0, 0.0001) * 1.2;
    const barW = plotW / (sprintsOldestFirst.length || 1);
    const y = (v: number) => padT + plotH - (v / maxVal) * plotH;

    const bars = sprintsOldestFirst.map((s, i) => {
        const v = valueOf(metricKey, s, valueKey);
        const barH = plotH - (y(v) - padT);
        const x = padL + i * barW + barW * 0.15;
        const bw = barW * 0.7;
        const isCurrent = i === sprintsOldestFirst.length - 1;
        return `
      <rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${barH.toFixed(1)}"
            fill="${isCurrent ? '#1976d2' : '#90caf9'}" rx="2" />
      <text x="${(x + bw / 2).toFixed(1)}" y="${(y(v) - 4).toFixed(1)}" font-size="10" text-anchor="middle" fill="#333">${v.toFixed(decimals)}${unit}</text>
      <text x="${(x + bw / 2).toFixed(1)}" y="${h - padB + 14}" font-size="9" text-anchor="middle" fill="#666">${shortSprintName(s.sprintName)}</text>`;
    }).join('');

    const avgLine = avg != null ? `
      <line x1="${padL}" y1="${y(avg).toFixed(1)}" x2="${w - padR}" y2="${y(avg).toFixed(1)}" stroke="#f44336" stroke-width="1.5" stroke-dasharray="5,4" />
      <text x="${w - padR}" y="${(y(avg) - 4).toFixed(1)}" font-size="9" text-anchor="end" fill="#f44336">prior avg ${avg.toFixed(decimals)}${unit}</text>` : '';

    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}" stroke="#ccc" />
      <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="#ccc" />
      ${bars}
      ${avgLine}
    </svg>`;
}

function renderTable(sprintsOldestFirst: TrendSprint[], metricKey: typeof METRICS[number]['key'], decimals: number, unit: string, valueKey?: string, periodWord: string = 'Sprint'): string {
    const rows = sprintsOldestFirst.map(s =>
        `<tr><td>${s.sprintName}</td><td>${s.startDate ?? ''} - ${s.endDate ?? ''}</td><td style="text-align:right">${valueOf(metricKey, s, valueKey).toFixed(decimals)}${unit}</td></tr>`
    ).join('');
    return `<table class="data"><thead><tr><th>${periodWord}</th><th>Dates</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function summaryBadge(summary: MetricSummary): string {
    const color = HEALTH_COLOR[summary.health] || '#999';
    return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}">
      ${HEALTH_LABELS[summary.health]} &middot; ${TREND_LABELS[summary.trend]} ${summary.trendPct > 0 ? '+' : ''}${summary.trendPct}%
    </span>`;
}

export function buildTrendsHtml(byProject: MergedProjectTrends[], title: string): string {
    const sections = METRICS.map(m => {
        const blocks = byProject.map(p => {
            const data = p[m.key];
            if (!data || !data.sprints.length) return '';
            const oldestFirst = [...data.sprints].reverse();
            const isKanbanThroughput = m.key === 'productivity' && (data as any).metricKind === 'throughput';
            const unit = isKanbanThroughput ? ' SP' : m.unit;
            const valueKey = isKanbanThroughput ? 'spDone' : undefined;
            const periodWord = isKanbanThroughput ? 'Span' : 'Sprint';
            return `
        <div class="block">
          <h3>${p.projectName} <span class="muted">(${p.accountName})</span></h3>
          <div class="summary">Current: <b>${data.summary.current ?? '-'}${unit}</b> &nbsp; ${summaryBadge(data.summary)}</div>
          <div class="chart-row">
            ${renderBarChart(oldestFirst, m.key, data.summary.avg, m.decimals, unit, valueKey)}
            ${renderTable(oldestFirst, m.key, m.decimals, unit, valueKey, periodWord)}
          </div>
        </div>`;
        }).join('');
        return `<section><h2>${m.label}</h2>${blocks}</section>`;
    }).join('');

    return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; margin: 24px; color: #222; background: #fafafa; }
  h1 { margin-bottom: 4px; }
  .muted { color: #888; font-weight: normal; font-size: 0.85em; }
  section { margin-bottom: 40px; }
  .block { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .chart-row { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
  table.data { border-collapse: collapse; font-size: 13px; min-width: 280px; }
  table.data th, table.data td { border: 1px solid #e0e0e0; padding: 4px 10px; }
  table.data th { background: #f5f5f5; text-align: left; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
  .summary { margin-bottom: 10px; font-size: 14px; }
</style>
</head><body>
  <h1>${title}</h1>
  <p class="muted">Last 5 completed sprints &middot; generated from live sync data</p>
  ${sections}
</body></html>`;
}

function addMetricSheet(wb: ExcelJS.Workbook, sheetName: string, byProject: MergedProjectTrends[], metricKey: typeof METRICS[number]['key'], decimals: number, noteText: string) {
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [
        { header: 'Account', key: 'account', width: 22 },
        { header: 'Project', key: 'project', width: 24 },
        { header: 'Sprint -4', key: 's4', width: 12 },
        { header: 'Sprint -3', key: 's3', width: 12 },
        { header: 'Sprint -2', key: 's2', width: 12 },
        { header: 'Sprint -1', key: 's1', width: 12 },
        { header: 'Current', key: 's0', width: 12 },
        { header: 'Prior Avg', key: 'avg', width: 12 },
        { header: 'Trend %', key: 'trendPct', width: 10 },
        { header: 'Trend', key: 'trend', width: 9 },
        { header: 'Health', key: 'health', width: 14 },
        { header: 'Current Sprint', key: 'curName', width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { horizontal: 'center' };

    for (const p of byProject) {
        const data = p[metricKey];
        if (!data) continue;
        // Same fix as the HTML export: a Kanban project's productivity value is
        // spDone (SP completed), not spDone/spPlanned% -- reading the metric's
        // own key unconditionally mismatched this row's own Current/Prior-Avg
        // columns, which already come from the SP-based summary.
        const kanbanValueKey = metricKey === 'productivity' && (data as any).metricKind === 'throughput' ? 'spDone' : undefined;
        const padded: (TrendSprint | null)[] = [...data.sprints];
        while (padded.length < 5) padded.push(null);
        const [s0, s1, s2, s3, s4] = padded;

        const row = ws.addRow({
            account: p.accountName,
            project: p.projectName,
            s4: s4 ? valueOf(metricKey, s4, kanbanValueKey) : null,
            s3: s3 ? valueOf(metricKey, s3, kanbanValueKey) : null,
            s2: s2 ? valueOf(metricKey, s2, kanbanValueKey) : null,
            s1: s1 ? valueOf(metricKey, s1, kanbanValueKey) : null,
            s0: s0 ? valueOf(metricKey, s0, kanbanValueKey) : null,
            avg: data.summary.avg,
            trendPct: data.summary.trendPct,
            trend: TREND_LABELS[data.summary.trend],
            health: HEALTH_LABELS[data.summary.health],
            curName: s0 ? s0.sprintName : '',
        });

        for (const key of ['s4', 's3', 's2', 's1', 's0', 'avg']) {
            const cell = row.getCell(key);
            cell.numFmt = decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`;
            cell.alignment = { horizontal: 'center' };
        }
        row.getCell('trendPct').numFmt = '+0;-0;0';
        row.getCell('trendPct').alignment = { horizontal: 'center' };
        row.getCell('trend').alignment = { horizontal: 'center' };
        row.getCell('health').alignment = { horizontal: 'center' };
        row.getCell('s0').font = { bold: true };

        row.getCell('trend').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TREND_FILL[data.summary.trend] } };
        row.getCell('health').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEALTH_FILL[data.summary.health] } };
    }

    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: 'L1' };

    const note = ws.addRow([]);
    note.getCell(1).value = noteText;
    ws.mergeCells(`A${note.number}:L${note.number}`);
    note.font = { italic: true, color: { argb: 'FF666666' }, size: 10 };
    note.alignment = { wrapText: true };
}

export async function buildTrendsWorkbook(byProject: MergedProjectTrends[]): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DSR Generator — Team Performance Trends export';
    wb.created = new Date();

    addMetricSheet(wb, 'Productivity', byProject, 'productivity', 1,
        'Productivity = SP Done / SP Planned x 100 (excl. punted). Trend = Current vs avg of prior 4 sprints (+/-5% dead-band). Health: green >=80, amber 60-79, red <60.');
    addMetricSheet(wb, 'Defect Density', byProject, 'defectDensity', 2,
        'Defect Density = prod bugs / SP done for the sprint. Trend = Current vs avg of prior 4 sprints (+/-5% dead-band).');
    addMetricSheet(wb, 'Reopen Ratio', byProject, 'reopenRatio', 1,
        'Reopen Ratio = reopened stories / total stories x 100 (excl. Sub-bugs). Trend = Current vs avg of prior 4 sprints (+/-5% dead-band).');

    return wb;
}

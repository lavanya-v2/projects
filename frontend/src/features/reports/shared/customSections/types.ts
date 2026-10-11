export type CustomColumnType = 'text' | 'number' | 'percentage' | 'date';

export interface CustomColumn {
  key: string;
  label: string;
  type: CustomColumnType;
}

export interface CustomChartConfig {
  type: 'bar' | 'stacked-bar' | 'line';
  categoryColumn: string;
  valueColumns: string[];
}

export interface CustomSection {
  id: string;
  title: string;
  displayMode: 'table' | 'chart';
  columns: CustomColumn[];
  rows: Array<Record<string, string | number | null>>;
  chart?: CustomChartConfig;
}

export const MAX_SECTIONS = 12;

// Custom sections lay out on a 12-column grid, two rows tall: four half-width
// cells per page/slide. Pagination counts that footprint rather than raw section
// count — a full-width section eats two cells — so a page never spills onto a
// third row and never strands an empty cell with content on the next page.
export const PAGE_UNITS = 4;

// Wide tables (many columns with long headers) need the full width; otherwise
// headers wrap into tall, lopsided stacks in a half-width card. Charts with many
// categories need it too — at half width recharts silently drops X-axis labels
// because the ticks no longer fit. Deliberately independent of how many sections
// share the page, so the paginator and the renderer agree on the footprint.
export function sectionSpan(section: CustomSection): number {
  const wideTable = section.displayMode !== 'chart' && section.columns.length >= 5;
  const wideChart = section.displayMode === 'chart' && (section.rows?.length ?? 0) >= 7;
  return wideTable || wideChart ? 12 : 6;
}

// Greedily pack sections into pages of PAGE_UNITS half-cells, preserving the
// user's ordering — reordering their sections to fill gaps would be surprising.
export function paginateSections(all: CustomSection[]): CustomSection[][] {
  const pages: CustomSection[][] = [];
  let current: CustomSection[] = [];
  let used = 0;
  for (const section of all) {
    const units = sectionSpan(section) === 12 ? 2 : 1;
    if (used + units > PAGE_UNITS && current.length > 0) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(section);
    used += units;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}
export const MAX_ROWS = 15;
export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 6;

export const COLUMN_TYPES: Array<{ value: CustomColumnType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'date', label: 'Date' },
];

export const CHART_TYPES: Array<{ value: CustomChartConfig['type']; label: string }> = [
  { value: 'bar', label: 'Bar' },
  { value: 'stacked-bar', label: 'Stacked Bar' },
  { value: 'line', label: 'Line' },
];

export const NUMERIC_TYPES = new Set<CustomColumnType>(['number', 'percentage']);
export const CATEGORY_TYPES = new Set<CustomColumnType>(['text', 'date']);

export const CHART_PALETTE = ['#1565c0', '#2e7d32', '#e65100', '#6a1b9a', '#00695c', '#b71c1c'];

export function makeSectionId(): string {
  return `sec_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export function makeColumnKey(): string {
  return `col_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export function formatCellValue(value: string | number | null | undefined, type: CustomColumnType): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'percentage') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n}%`;
  }
  if (type === 'date') {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return String(value);
}

export function isChartConfigValid(section: CustomSection): boolean {
  if (section.displayMode !== 'chart') return true;
  if (!section.chart) return false;
  const colByKey = new Map(section.columns.map(c => [c.key, c]));
  const cat = colByKey.get(section.chart.categoryColumn);
  if (!cat || !CATEGORY_TYPES.has(cat.type)) return false;
  if (!section.chart.valueColumns.length) return false;
  for (const k of section.chart.valueColumns) {
    const col = colByKey.get(k);
    if (!col || !NUMERIC_TYPES.has(col.type)) return false;
  }
  return true;
}

import ExcelJS from 'exceljs';

/**
 * Deterministic fixture files.
 *
 * Fixtures are written as literal cell values and the tests assert against literal expected totals.
 * Nothing here computes an expectation by running the parser -- a test that derives its expected
 * value from the code under test proves only that the code is self-consistent, not that it is right.
 */

export type Cell = string | number | Date | null | undefined;

/** The Azure DevOps export shape the Excel work was built against. */
export const AZURE_HEADERS = [
  'ID',
  'Title',
  'Work Item Type',
  'State',
  'Priority',
  'Effort',
  'Assigned To',
  'Iteration Path',
  'Created Date',
  'Changed Date',
  'Parent',
  'Tags',
] as const;

/** Field key -> Azure header, i.e. the mapping a project on this export would store. */
export const AZURE_MAPPING: Record<string, string> = {
  externalId: 'ID',
  title: 'Title',
  type: 'Work Item Type',
  status: 'State',
  priority: 'Priority',
  storyPoints: 'Effort',
  assigneeEmail: 'Assigned To',
  sprintName: 'Iteration Path',
  createdDate: 'Created Date',
  lastUpdated: 'Changed Date',
  parentExtId: 'Parent',
  labels: 'Tags',
};

export interface AzureRow {
  id: string;
  title?: string;
  type?: string;
  state?: string;
  priority?: string;
  /** Story points. `null` means the cell is genuinely blank, which is not the same as 0. */
  effort?: number | string | null;
  assignee?: string;
  iteration?: string;
  created?: string;
  changed?: string;
  parent?: string;
  tags?: string;
}

const DEFAULTS = {
  title: 'Untitled',
  type: 'Product Backlog Item',
  state: 'New',
  priority: '2',
  assignee: '',
  iteration: 'Sprint A',
  created: '2026-01-01',
  changed: '2026-01-10',
  parent: '',
  tags: '',
};

/** One Azure-shaped row as a cell array, in AZURE_HEADERS order. */
export function azureCells(row: AzureRow): Cell[] {
  return [
    row.id,
    row.title ?? DEFAULTS.title,
    row.type ?? DEFAULTS.type,
    row.state ?? DEFAULTS.state,
    row.priority ?? DEFAULTS.priority,
    row.effort === undefined ? null : row.effort,
    row.assignee ?? DEFAULTS.assignee,
    row.iteration ?? DEFAULTS.iteration,
    new Date(row.created ?? DEFAULTS.created),
    new Date(row.changed ?? DEFAULTS.changed),
    row.parent ?? DEFAULTS.parent,
    row.tags ?? DEFAULTS.tags,
  ];
}

/** A workbook with an explicit header row and cell matrix. */
export async function buildWorkbook(
  headers: readonly string[],
  rows: Cell[][],
  opts: { sheetName?: string } = {}
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(opts.sheetName ?? 'Issues');

  sheet.addRow([...headers]);
  for (const row of rows) {
    sheet.addRow(row.map(cell => (cell === undefined ? null : cell)));
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** An Azure-shaped workbook. The common case. */
export function buildAzureWorkbook(rows: AzureRow[]): Promise<Buffer> {
  return buildWorkbook(AZURE_HEADERS, rows.map(azureCells));
}

/** The same data as CSV, for asserting the two parsers agree. */
export function buildCsv(headers: readonly string[], rows: Cell[][]): Buffer {
  const cell = (value: Cell): string => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString().split('T')[0] : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [headers.map(cell).join(','), ...rows.map(row => row.map(cell).join(','))];
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

export function buildAzureCsv(rows: AzureRow[]): Buffer {
  return buildCsv(AZURE_HEADERS, rows.map(azureCells));
}

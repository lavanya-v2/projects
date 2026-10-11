import ExcelJS from 'exceljs';
import { ExcelTemplate } from './types';

const SCRUM_HEADERS = [
  'External ID',
  'Title',
  'Type',
  'Status',
  'Priority',
  'Assignee Email',
  'Story Points',
  'Sprint Name',
  'Sprint Start Date',
  'Sprint End Date',
  'Created Date',
  'Last Updated',
  'Status Changed On',
  'Parent / Epic',
  'Labels',
];

const KANBAN_HEADERS = [
  'External ID',
  'Title',
  'Type',
  'Status',
  'Priority',
  'Assignee Email',
  'Story Points',
  'Created Date',
  'Last Updated',
  'Status Changed On',
  'Done Date',
  'Parent / Epic',
  'Labels',
];

const HISTORY_HEADERS = ['External ID', 'From Status', 'To Status', 'Changed On', 'Changed By'];

const SAMPLE_SCRUM_ROW: (string | number | Date)[] = [
  'ABC-101',
  'Sample ticket title',
  'Story',
  'In Progress',
  'High',
  'alice@example.com',
  3,
  'Sprint 10',
  new Date('2026-04-01'),
  new Date('2026-04-14'),
  new Date('2026-04-02'),
  new Date('2026-04-10'),
  new Date('2026-04-05'),
  'ABC-50',
  'backend;urgent',
];

const SAMPLE_KANBAN_ROW: (string | number | Date)[] = [
  'ABC-101',
  'Sample kanban card',
  'Task',
  'Done',
  'Medium',
  'alice@example.com',
  2,
  new Date('2026-04-01'),
  new Date('2026-04-10'),
  new Date('2026-04-09'),
  new Date('2026-04-10'),
  '',
  'ops',
];

const SAMPLE_HISTORY_ROW: (string | Date)[] = [
  'ABC-101',
  'To Do',
  'In Progress',
  new Date('2026-04-05'),
  'alice@example.com',
];

const INSTRUCTIONS: string[] = [
  'DSR Generator — Excel Import Template',
  '',
  'HOW TO USE:',
  '  1. Fill the "Issues" sheet with your work items. Each row = one ticket / work item.',
  '  2. Required columns are marked (see README on second row of Issues sheet).',
  '  3. Optionally, fill the "Status History" sheet with your status-change log. This gives',
  '     accurate cycle-time and re-open metrics. Without it, metrics run in "approximate" mode.',
  '  4. Save and upload via the DSR Generator Admin page.',
  '',
  'TEMPLATES:',
  '  - Scrum:  for sprint-based teams. Requires Sprint Name + Start + End.',
  '  - Kanban: for flow-based teams. Requires Done Date in place of sprint fields.',
  '',
  'VALIDATION:',
  '  - Strict pass first (exact headers, enums, dates).',
  '  - Falls back to best-effort (fuzzy headers, enum aliases, date coercions).',
  '  - Any best-effort coercions are shown for confirmation before persisting.',
];

export function buildTemplateWorkbook(
  template: ExcelTemplate,
  estimationType: 'story_points' | 'hours' = 'story_points'
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DSR Generator';

  const info = wb.addWorksheet('README');
  INSTRUCTIONS.forEach(line => info.addRow([line]));
  info.getColumn(1).width = 100;

  const issues = wb.addWorksheet('Issues');
  const baseHeaders = template === 'scrum' ? SCRUM_HEADERS : KANBAN_HEADERS;
  // Hours-based projects estimate in hours — relabel the estimate column so the
  // expected unit is unambiguous. Both headers map to the same parsed value.
  const headers =
    estimationType === 'hours' ? baseHeaders.map(h => (h === 'Story Points' ? 'Estimated Hours' : h)) : baseHeaders;
  issues.addRow(headers);
  issues.getRow(1).font = { bold: true };
  issues.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDEEBFF' },
  };
  issues.addRow(template === 'scrum' ? SAMPLE_SCRUM_ROW : SAMPLE_KANBAN_ROW);
  issues.columns.forEach(col => {
    col.width = 22;
  });

  const history = wb.addWorksheet('Status History');
  history.addRow(HISTORY_HEADERS);
  history.getRow(1).font = { bold: true };
  history.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDEEBFF' },
  };
  history.addRow(SAMPLE_HISTORY_ROW);
  history.columns.forEach(col => {
    col.width = 22;
  });

  return wb;
}

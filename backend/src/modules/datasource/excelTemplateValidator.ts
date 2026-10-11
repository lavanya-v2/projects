import { isEmpty } from 'lodash';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { TemplateMapping } from '../../models/TemplateMapping';
import { randomUUID } from 'crypto';

import {
  ExcelRowParsed,
  ExcelHistoryRow,
  CoercionNote,
  ValidationError,
  MappingReportEntry,
  SprintCoverage,
  ValidationResult,
  MappingFieldSpec,
  ValidateOptions,
  HeaderIndex,
  ColumnMatch,
  ExcelTemplate,
  ValidationMode,
} from './types';

const emptyCoverage = (): SprintCoverage => ({
  rowsMissingSprint: 0,
  rowsWithSprint: 0,
  sprintsInFile: [],
  declaredSprintApplied: false,
});

/**
 * Single source of truth for internal field -> customer header resolution. Used by the row reader,
 * the preflight report and the required-column check alike, so they can never disagree.
 */
const MAPPING_FIELDS: MappingFieldSpec[] = [
  { key: 'externalId', label: 'External ID', fallbacks: ['External ID'] },
  { key: 'title', label: 'Title', fallbacks: ['Title'] },
  { key: 'type', label: 'Type', fallbacks: ['Type'] },
  { key: 'status', label: 'Status', fallbacks: ['Status'] },
  { key: 'priority', label: 'Priority', fallbacks: ['Priority'] },
  { key: 'assigneeEmail', label: 'Assignee Email', fallbacks: ['Assignee Email'] },
  // The required-header list says 'Sprint Name' but the built-in template ships 'Sprint'; accept both.
  { key: 'sprintName', label: 'Sprint Name', fallbacks: ['Sprint Name', 'Sprint'] },
  { key: 'storyPoints', label: 'Story Points', fallbacks: ['Story Points'] },
  { key: 'createdDate', label: 'Created Date', fallbacks: ['Created Date'] },
  { key: 'lastUpdated', label: 'Last Updated', fallbacks: ['Last Updated'] },
  { key: 'sprintStartDate', label: 'Sprint Start Date', fallbacks: ['Sprint Start Date'] },
  {
    key: 'sprintEndDate',
    label: 'Sprint End Date',
    fallbacks: ['Sprint End Date', 'Custom field (Actual End)'],
  },
  { key: 'statusChangedOn', label: 'Status Changed On', fallbacks: ['Status Changed On'] },
  { key: 'doneDate', label: 'Done Date', fallbacks: ['Done Date'] },
  // Azure DevOps exports call this column simply 'Parent'.
  { key: 'parentExtId', label: 'Parent / Epic', fallbacks: ['Parent / Epic', 'Parent'] },
  { key: 'labels', label: 'Labels', fallbacks: ['Labels'] },
];

const MAPPING_FIELDS_BY_KEY: Record<string, MappingFieldSpec> = Object.fromEntries(
  MAPPING_FIELDS.map(spec => [spec.key, spec])
);

/**
 * The mappable fields, as the mapping editor and the mapping-save endpoint should see them.
 *
 * Exported so there is exactly one list. The save endpoint used to derive a storage key by
 * camel-casing whatever label the client sent, which silently produced keys no reader ever looks
 * up -- 'Parent / Epic' became 'parent/Epic', and the mapping was stored nowhere useful.
 */
export const MAPPABLE_FIELDS: ReadonlyArray<{ key: string; label: string }> = MAPPING_FIELDS.map(({ key, label }) => ({
  key,
  label,
}));

const REQUIRED_HEADERS_SCRUM = [
  'External ID',
  'Title',
  'Type',
  'Status',
  'Assignee Email',
  'Sprint Name',
  'Sprint Start Date',
  'Sprint End Date',
  'Created Date',
  'Last Updated',
] as const;

const REQUIRED_HEADERS_KANBAN = [
  'External ID',
  'Title',
  'Type',
  'Status',
  'Assignee Email',
  'Created Date',
  'Last Updated',
] as const;

export const TYPE_ENUM = ['Story', 'Task', 'Bug', 'Spike', 'Epic', 'Backlog', 'Test Case'];
export const TYPE_ALIASES: Record<string, string> = {
  story: 'Story',
  task: 'Task',
  bug: 'Bug',
  defect: 'Bug',
  spike: 'Spike',
  epic: 'Epic',
  feature: 'Epic',
  us: 'Story',
  'user story': 'Story',
  'product backlog item': 'Backlog',
};

/** Types accepted verbatim in strict mode. Anything else is an alias resolved only in best_effort. */
const STRICT_TYPES = [...TYPE_ENUM, 'Sub-task'];

export const NO_MAPPING_MESSAGE =
  'This project has no column mapping configured. Set one up in Project settings before uploading.';

/**
 * Resolve a client-supplied mapping key to its internal field key. Accepts the internal key itself
 * or the human label; returns undefined for anything unrecognised, which the caller drops.
 */
export function resolveMappingKey(candidate: string): string | undefined {
  const wanted = candidate.trim().toLowerCase();

  return MAPPING_FIELDS.find(spec => spec.key.toLowerCase() === wanted || spec.label.toLowerCase() === wanted)?.key;
}

/**
 * Resolve the header candidates for one internal field.
 *
 * Historically this was `headerMap[key] ?? fallback`, which does NOT fall back on the empty string.
 * Every optional column on template_mappings defaulted to '', so an unmapped field resolved to the
 * empty header, missed the header index and silently produced undefined -- which downstream became
 * a literal 0. Treating blank as "not configured" is the single seam that fixes that for every field.
 */
function resolveCandidates(headerMap: Record<string, string>, spec: MappingFieldSpec): string[] {
  const mapped = headerMap[spec.key];
  return isConfigured(mapped) ? [mapped.trim()] : spec.fallbacks;
}

/**
 * Strict mode demands a canonical type; best_effort resolves aliases and casing and records what it
 * did. This is what makes the two-pass strict -> best_effort retry meaningful: previously both
 * passes behaved identically, so the retry could never turn a failure into a success.
 */
function resolveType(raw: string, mode: ValidationMode): { value: string; coerced?: string; error?: string } {
  const cleaned = raw.replace(/^OneSDLC\s*/i, '').trim();

  if (STRICT_TYPES.includes(cleaned)) {
    return { value: cleaned };
  }

  if (mode === 'strict' || !cleaned) {
    return { value: cleaned, error: `Invalid type: ${raw}` };
  }

  const lower = cleaned.toLowerCase();
  const canonical = TYPE_ALIASES[lower] ?? STRICT_TYPES.find(type => type.toLowerCase() === lower);

  if (!canonical) {
    return { value: cleaned, error: `Invalid type: ${raw}` };
  }

  return { value: canonical, coerced: canonical };
}

/**
 * First candidate header that resolves to a column wins. Strict mode requires the header to appear
 * verbatim; best_effort also accepts a case- and punctuation-insensitive match and reports it as a
 * coercion.
 */
function resolveColumn(index: HeaderIndex, candidates: string[], mode: ValidationMode): ColumnMatch {
  for (const candidate of candidates) {
    const column = index.exact.get(candidate.trim());

    if (column !== undefined) {
      return { column, header: candidate.trim(), lenient: false };
    }
  }

  if (mode === 'strict') {
    return { lenient: false };
  }

  for (const candidate of candidates) {
    const column = index.loose.get(normalizeHeader(candidate));

    if (column !== undefined) {
      return { column, header: candidate.trim(), lenient: true };
    }
  }

  return { lenient: false };
}

/** A mapping value only counts as configured when it is a non-blank string. */
function isConfigured(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Best-effort numeric recovery for shapes Excel exports commonly carry: "5 SP", "8 hrs", "3,5",
 * "(2)". Returns undefined when nothing numeric can be recovered, e.g. "-" or "TBD".
 */
function coerceNumber(raw: string): number | undefined {
  let text = raw.trim();

  // Accountancy-style negatives: (2) -> -2
  const bracketed = /^\((.*)\)$/.exec(text);

  if (bracketed) {
    text = `-${bracketed[1]}`;
  }

  const match = /-?\d+(?:[.,]\d+)?/.exec(text);

  if (!match) {
    return undefined;
  }

  const num = Number(match[0].replace(',', '.'));
  return Number.isNaN(num) ? undefined : num;
}

function normalizeType(raw: string): string {
  if (!raw) {
    return '';
  }

  raw = raw.replace(/^OneSDLC\s*/i, '').trim();
  const found = [...STRICT_TYPES, ...Object.keys(TYPE_ALIASES)].find(type => type.toLowerCase() === raw.toLowerCase());
  return found ?? raw;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[()]/g, '').replace(/_/g, ' ').replace(/-/g, ' ');
}

function buildHeaderIndex(headers: string[]): HeaderIndex {
  const exact = new Map<string, number>();
  const loose = new Map<string, number>();

  headers.forEach((header, index) => {
    // Keep FIRST duplicate
    const column = index + 1;
    const trimmed = header.trim();

    if (trimmed && !exact.has(trimmed)) {
      exact.set(trimmed, column);
    }

    const key = normalizeHeader(header);

    if (key && !loose.has(key)) {
      loose.set(key, column);
    }
  });

  return { exact, loose };
}

/*
 * Select the mapping columns by name rather than excluding known metadata.
 *
 * The row also carries the retained sample file, its header list and version stamps. Under an
 * exclude-list those leaked into the header map, where `requiredHeadersFor` would treat a value
 * like the storage path as a column the uploaded file must contain -- rejecting every upload. An
 * allow-list driven by MAPPING_FIELDS cannot drift as columns are added.
 */
const getCustomHeaders = async (template: string): Promise<Record<string, string>> => {
  const row = (await TemplateMapping.findOne({
    attributes: MAPPING_FIELDS.map(spec => spec.key),
    where: { projectId: Number(template), active: true },
    raw: true,
  })) as Record<string, string> | null;

  if (!row) {
    return {};
  }

  /*
   * Pick the mapping fields out of the row explicitly rather than trusting the SQL projection
   * alone. The projection is the first line of defence; this is what holds if any caller ever
   * hands over a full row. Unconfigured fields are dropped so an all-blank mapping still reads as
   * "no mapping" rather than as a mapping of nothing.
   */
  return Object.fromEntries(
    MAPPING_FIELDS.map(spec => [spec.key, row[spec.key]]).filter(([, value]) => isConfigured(value))
  );
};

/**
 * The column headers of a sample file, without validating anything else about it.
 *
 * Used when setting up a column mapping: the server reads the headers itself rather than trusting a
 * list the browser parsed, and they are then stored against the mapping so it stays editable
 * without the file being uploaded again.
 *
 * Throws with a message meant for the user -- an unreadable sample is a normal thing to hit.
 */
export async function extractHeaders(buffer: Buffer, fileType: 'excel' | 'csv'): Promise<string[]> {
  if (fileType === 'csv') {
    const records: string[][] = parse(buffer.toString('utf8'), { skip_empty_lines: true, to_line: 1 });
    const headers = (records[0] ?? []).map(h => String(h ?? '').trim());

    if (headers.filter(Boolean).length === 0) {
      throw new Error('No column headers found. The first row of the file should be the header row.');
    }

    return headers;
  }

  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  try {
    await workbook.xlsx.load(arrayBuffer);
  } catch {
    // The underlying zip reader reports things like "Can't find end of central directory" with a
    // link to its own docs. True, and useless to someone who picked the wrong file.
    throw new Error(
      'This file could not be read as a spreadsheet. Check it is a valid .xlsx and not password-protected.'
    );
  }

  const sheet = workbook.getWorksheet('Issues') ?? workbook.worksheets[0];

  if (!sheet) {
    throw new Error('This workbook has no sheets to read columns from.');
  }

  const headers = headerRowOf(sheet);

  if (headers.filter(Boolean).length === 0) {
    throw new Error('No column headers found. The first row of the sheet should be the header row.');
  }

  return headers;
}

function requiredHeadersFor(template: ExcelTemplate, headerMap: Record<string, string>): readonly string[] {
  if (template === 'scrum') {
    return REQUIRED_HEADERS_SCRUM;
  }

  if (template === 'kanban') {
    return REQUIRED_HEADERS_KANBAN;
  }

  // For a custom mapping, the columns the customer actually configured are the ones we require.
  return Object.values(headerMap).filter(isConfigured);
}

/** Read a worksheet's header row. The single definition both validation and mapping setup use. */
function headerRowOf(sheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];

  sheet.getRow(1).eachCell(cell => {
    headers.push(String(cell.text ?? cell.value ?? '').trim());
  });

  return headers;
}

export async function validateExcelBuffer(
  buffer: Buffer,
  template: ExcelTemplate,
  dataSourceType: string | undefined,
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  const workbook = new ExcelJS.Workbook();

  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  await workbook.xlsx.load(arrayBuffer);

  const issuesSheet = workbook.getWorksheet('Issues') ?? workbook.worksheets[0];

  if (!issuesSheet) {
    return emptyResult(template, 'strict', [
      {
        row: 0,
        reason: 'No sheets found in workbook',
      },
    ]);
  }

  const headers = headerRowOf(issuesSheet);

  const isCustom = template !== 'scrum' && template !== 'kanban';
  const headerMap = isCustom ? await getCustomHeaders(template) : {};

  // Without an active mapping the required-column list used to come back empty, which meant a
  // custom-template upload was validated against nothing at all. Fail loudly instead.
  if (isCustom && Object.keys(headerMap).length === 0) {
    return emptyResult(template, 'strict', [{ row: 0, reason: NO_MAPPING_MESSAGE }]);
  }

  const required = requiredHeadersFor(template, headerMap);
  const strictResult = tryParse(issuesSheet, headers, required, headerMap, template, dataSourceType, 'strict', options);

  if (strictResult.ok) {
    strictResult.history = parseHistorySheet(workbook);
    return strictResult;
  }

  const bestEffortResult = tryParse(
    issuesSheet,
    headers,
    required,
    headerMap,
    template,
    dataSourceType,
    'best_effort',
    options
  );
  bestEffortResult.history = parseHistorySheet(workbook);
  return bestEffortResult;
}

export async function validateCsvBuffer(
  buffer: Buffer,
  template: ExcelTemplate,
  dataSourceType: string | undefined,
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  const csv = buffer.toString('utf8');

  const records: string[][] = parse(csv, {
    skip_empty_lines: true,
  });

  if (records.length === 0) {
    return emptyResult(template, 'strict', [
      {
        row: 0,
        reason: 'CSV file is empty',
      },
    ]);
  }

  const headers = records[0];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Issues');

  sheet.addRow(headers);

  for (let i = 1; i < records.length; i++) {
    sheet.addRow(records[i]);
  }

  const isCustom = template !== 'scrum' && template !== 'kanban';
  const headerMap = isCustom ? await getCustomHeaders(template) : {};

  if (isCustom && Object.keys(headerMap).length === 0) {
    return emptyResult(template, 'strict', [{ row: 0, reason: NO_MAPPING_MESSAGE }]);
  }

  const required = requiredHeadersFor(template, headerMap);
  const strictResult = tryParse(sheet, headers, required, headerMap, template, dataSourceType, 'strict', options);

  if (strictResult.ok) {
    return strictResult;
  }

  // CSV previously skipped the best-effort retry entirely, so coercible values failed outright.
  return tryParse(sheet, headers, required, headerMap, template, dataSourceType, 'best_effort', options);
}

/**
 * Which internal field resolved to which column, and whether it was found. Built from the same
 * MAPPING_FIELDS/resolveCandidates pair the row reader uses, so the report cannot drift from the
 * parse.
 */
function buildMappingReport(
  headerMap: Record<string, string>,
  matches: Map<string, ColumnMatch>,
  template: ExcelTemplate
): MappingReportEntry[] {
  const skipSprintFields = template === 'kanban';

  return MAPPING_FIELDS.filter(
    spec => !skipSprintFields || !['sprintName', 'sprintStartDate', 'sprintEndDate'].includes(spec.key)
  ).map(spec => {
    const mapped = headerMap[spec.key];
    const configured = isConfigured(mapped);
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars*/
    const candidates = resolveCandidates(headerMap, spec);

    const match = matches.get(spec.key);

    if (match?.column !== undefined) {
      return {
        field: spec.key,
        label: spec.label,
        mappedHeader: configured ? mapped.trim() : undefined,
        usedHeader: match.header,
        matched: true,
        column: match.column,
        source: configured ? ('mapping' as const) : ('default' as const),
      };
    }

    return {
      field: spec.key,
      label: spec.label,
      mappedHeader: configured ? mapped.trim() : undefined,
      matched: false,
      source: configured ? ('mapping' as const) : ('none' as const),
    };
  });
}

/**
 * Reads cells by internal field key. Columns are resolved once per sheet rather than per row, which
 * also removes a per-row header lookup from the hot loop.
 */
class RowReader {
  constructor(
    private readonly row: ExcelJS.Row,
    private readonly columns: Map<string, number>,
    private readonly mode: ValidationMode = 'strict',
    private readonly coercions: CoercionNote[] = [],
    private readonly rowNumber: number = 0
  ) {}

  private cell(field: string): ExcelJS.Cell | undefined {
    const column = this.columns.get(field);

    return column === undefined ? undefined : this.row.getCell(column);
  }

  string(field: string): string {
    const cell = this.cell(field);

    if (!cell) {
      return '';
    }

    if (cell.text) {
      return cell.text.trim();
    }

    const value = cell.value;

    if (value == null) {
      return '';
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      if ('text' in value) {
        return String(value.text).trim();
      }

      if ('richText' in value) {
        return value.richText
          .map(v => v.text)
          .join('')
          .trim();
      }

      if ('result' in value && value.result != null) {
        return String(value.result).trim();
      }

      if ('formula' in value && value.formula) {
        return String(value.result ?? '').trim();
      }
    }

    return String(value).trim();
  }

  /**
   * Reads a numeric cell. In strict mode a value that is present but not a plain number is an
   * error, which is what makes the two-pass strict -> best_effort retry actually engage. In
   * best_effort the same value is coerced where possible ("5 SP", "3,5", "8 hrs") and always
   * produces a visible note rather than a silent blank.
   */
  number(field: string, label = ''): { value?: number; error?: string } {
    const raw = this.string(field);

    if (!raw) {
      return {};
    }

    const direct = Number(raw);

    if (!Number.isNaN(direct)) {
      return { value: direct };
    }

    if (this.mode === 'strict') {
      return { error: `Not a number: "${raw}"` };
    }

    const coerced = coerceNumber(raw);

    this.coercions.push({
      row: this.rowNumber,
      column: label,
      original: raw,
      coerced: coerced ?? null,
      reason: coerced === undefined ? 'Could not read as a number — imported as blank' : 'Read as a number',
    });

    return { value: coerced };
  }

  date(field: string): Date | undefined {
    {
      const cell = this.cell(field);

      if (!cell) {
        return undefined;
      }

      const value = cell.value;

      if (value == null || value === '') {
        return undefined;
      }

      if (value instanceof Date) {
        return value;
      }

      if (typeof value === 'number') {
        return excelSerialToDate(value);
      }

      if (typeof value === 'object' && 'result' in value && value.result != null) {
        const result = value.result;

        if (result instanceof Date) {
          return result;
        }

        if (typeof result === 'number') {
          return excelSerialToDate(result);
        }

        const d = new Date(String(result));

        if (!isNaN(d.getTime())) {
          return d;
        }
      }

      const d = new Date(String(value));

      if (!isNaN(d.getTime())) {
        return d;
      }
    }

    return undefined;
  }
}

function tryParse(
  sheet: ExcelJS.Worksheet,
  headers: string[],
  required: readonly string[],
  headerMap: Record<string, string>,
  template: ExcelTemplate,
  dataSourceType: string | undefined,
  mode: ValidationMode,
  options: ValidateOptions = {}
): ValidationResult {
  const errors: ValidationError[] = [];
  const coercions: CoercionNote[] = [];

  const headerIndex = buildHeaderIndex(headers);

  // Resolve every internal field to a column once per sheet, then reuse for the report, the
  // required-column check and every row.
  const matches = new Map<string, ColumnMatch>();
  const columns = new Map<string, number>();
  const isCustomExcel = dataSourceType === 'custom-excel' || !columns.has('externalId');

  for (const spec of MAPPING_FIELDS) {
    const match = resolveColumn(headerIndex, resolveCandidates(headerMap, spec), mode);
    matches.set(spec.key, match);

    if (match.column !== undefined) {
      columns.set(spec.key, match.column);

      if (match.lenient) {
        coercions.push({
          row: 1,
          column: spec.label,
          original: headers[match.column - 1],
          coerced: match.header,
          reason: 'Header matched leniently (case/punctuation ignored)',
        });
      }
    }
  }

  const mappingReport = buildMappingReport(headerMap, matches, template);
  const declaredSprint = options.defaultSprintName?.trim() || undefined;

  /*
   * Sprint columns stop being mandatory once the uploader declares a sprint. Customer exports
   * frequently carry no Sprint column at all, and the sprint the rows belong to is supplied on the
   * upload form instead -- rejecting those files would make the declared-sprint flow unusable.
   */
  const sprintHeaders = declaredSprint
    ? new Set(
        ['sprintName', 'sprintStartDate', 'sprintEndDate'].flatMap(key =>
          resolveCandidates(headerMap, MAPPING_FIELDS_BY_KEY[key]).map(normalizeHeader)
        )
      )
    : new Set<string>();

  const validRequiredHeaders = required.filter(r => !isEmpty(r) && !sprintHeaders.has(normalizeHeader(r)));
  for (const header of validRequiredHeaders) {
    const column = resolveColumn(headerIndex, [header], mode).column;
    if (column === undefined) {
      errors.push({
        row: 1,
        column: header,
        reason: `Missing required column: ${header}`,
      });

      continue;
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      mode,
      template,
      rows: [],
      history: [],
      errors,
      coercions,
      mappingReport,
      sprintCoverage: emptyCoverage(),
    };
  }

  const rows: ExcelRowParsed[] = [];
  const seenIds = new Set<string>();

  // Sprint coverage counts every data row, including rows that later fail validation -- it
  // describes the file, not the subset that parsed cleanly.
  let rowsMissingSprint = 0;
  let rowsWithSprint = 0;
  const sprintRowCounts = new Map<string, { sprintName: string; rows: number }>();

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);

    if (isRowEmpty(row)) {
      continue;
    }

    const reader = new RowReader(row, columns, mode, coercions, r);
    const rowErrors: ValidationError[] = [];
    const extId = reader.string('externalId') || (isCustomExcel ? `CUSTOM-${randomUUID()}` : '');
    const title = reader.string('title');
    const rawType = reader.string('type');
    const typeRead = isCustomExcel ? { value: rawType } : resolveType(rawType, mode);
    const type = typeRead.value;
    const status = reader.string('status');
    const priority = reader.string('priority');
    const assigneeEmail = reader.string('assigneeEmail');
    // File value wins; otherwise fall back to the sprint the uploader declared.
    const fileSprintName = template === 'kanban' ? '' : reader.string('sprintName').trim();
    const sprintName = template === 'kanban' ? undefined : fileSprintName || declaredSprint;

    if (template !== 'kanban') {
      if (fileSprintName) {
        rowsWithSprint += 1;
        // Group case-insensitively, the same way sprint identity is keyed downstream.
        const key = fileSprintName.toLowerCase();
        const bucket = sprintRowCounts.get(key) ?? { sprintName: fileSprintName, rows: 0 };
        bucket.rows += 1;
        sprintRowCounts.set(key, bucket);
      } else {
        rowsMissingSprint += 1;
      }
    }
    const storyPointsRead = reader.number('storyPoints', 'Story Points');
    const storyPoints = storyPointsRead.value;
    const createdAt = reader.date('createdDate');
    const updatedAt = reader.date('lastUpdated');
    const sprintStart = template === 'kanban' ? undefined : reader.date('sprintStartDate');
    const sprintEnd = template === 'kanban' ? undefined : reader.date('sprintEndDate');

    const statusChangedOn = reader.date('statusChangedOn');
    const doneDate = reader.date('doneDate');
    const parentExtId = reader.string('parentExtId') || undefined;
    const labels = splitLabels(reader.string('labels'));

    if (storyPointsRead.error) {
      rowErrors.push({ row: r, column: 'Story Points', reason: storyPointsRead.error });
    }

    if (!isCustomExcel && typeRead.coerced) {
      coercions.push({
        row: r,
        column: 'Type',
        original: rawType,
        coerced: typeRead.coerced,
        reason: 'Type matched leniently',
      });
    }

    const requireField = (value: unknown, column: string) => {
      if (value === undefined || value === null || value === '') {
        rowErrors.push({
          row: r,
          column,
          reason: 'Required',
        });
      }
    };

    if (options.requireSprint && template !== 'kanban' && !sprintName) {
      rowErrors.push({
        row: r,
        column: 'Sprint Name',
        reason: 'Required — this project reports by sprint. Add a Sprint column or pick a sprint when uploading.',
      });
    }

    if (sprintStart && sprintEnd && sprintStart > sprintEnd) {
      rowErrors.push({ row: r, column: 'Sprint Start Date', reason: 'Sprint start is after sprint end' });
    }

    if (!isCustomExcel) {
      requireField(extId, 'External ID');
      requireField(status, 'Status');
      requireField(createdAt, 'Created Date');
      requireField(updatedAt, 'Last Updated');
    }
    requireField(title, 'Title');

    if (typeRead.error && !isCustomExcel) {
      rowErrors.push({
        row: r,
        column: 'Type',
        reason: typeRead.error,
      });
    }
    if (extId) {
      if (seenIds.has(extId)) {
        rowErrors.push({
          row: r,
          column: 'External ID',
          reason: `Duplicate External ID: ${extId}`,
        });
      }

      seenIds.add(extId);
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      extId,
      title,
      type,
      status,
      priority: priority || undefined,
      assigneeEmail,
      storyPoints,
      sprintName,
      sprintStart,
      sprintEnd,
      createdAt: createdAt!,
      updatedAt: updatedAt!,
      statusChangedOn,
      doneDate,
      parentExtId,
      labels,
    });
  }

  return {
    ok: errors.length === 0,
    mode,
    template,
    rows,
    history: [],
    errors,
    coercions,
    mappingReport,
    sprintCoverage: {
      rowsMissingSprint,
      rowsWithSprint,
      sprintsInFile: Array.from(sprintRowCounts.values()).sort(
        (a, b) => b.rows - a.rows || a.sprintName.localeCompare(b.sprintName)
      ),
      declaredSprintApplied: !!declaredSprint && rowsMissingSprint > 0,
    },
  };
}

function parseHistorySheet(workbook: ExcelJS.Workbook): ExcelHistoryRow[] {
  const sheet = workbook.getWorksheet('Status History');

  if (!sheet) {
    return [];
  }

  const headers: string[] = [];

  sheet.getRow(1).eachCell(cell => {
    headers.push(String(cell.text ?? cell.value ?? '').trim());
  });

  const headerIndex = buildHeaderIndex(headers);

  // The history sheet is our own fixed format, so it is always matched leniently.
  const historyColumns = new Map<string, number>();
  for (const header of ['External ID', 'From Status', 'To Status', 'Changed On', 'Changed By']) {
    const column = resolveColumn(headerIndex, [header], 'best_effort').column;

    if (column !== undefined) {
      historyColumns.set(header, column);
    }
  }

  const history: ExcelHistoryRow[] = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);

    if (isRowEmpty(row)) {
      continue;
    }

    const reader = new RowReader(row, historyColumns);

    const extId = reader.string('External ID');
    const fromStatus = reader.string('From Status');
    const toStatus = reader.string('To Status');
    const changedOn = reader.date('Changed On');
    const changedByEmail = reader.string('Changed By') || undefined;

    if (!extId || !toStatus || !changedOn) {
      continue;
    }

    history.push({
      extId,
      fromStatus,
      toStatus,
      changedOn,
      changedByEmail,
    });
  }

  return history;
}

function splitLabels(s: string): string[] | undefined {
  if (!s) return undefined;
  return s
    .split(/[;,]/)
    .map(t => t.trim())
    .filter(Boolean);
}

function isRowEmpty(row: ExcelJS.Row): boolean {
  let has = false;
  row.eachCell({ includeEmpty: false }, cell => {
    if (cell.value != null && String(cell.value).trim() !== '') has = true;
  });
  return !has;
}

function excelSerialToDate(serial: number): Date {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
}

function emptyResult(template: ExcelTemplate, mode: ValidationMode, errors: ValidationError[]): ValidationResult {
  return {
    ok: false,
    mode,
    template,
    rows: [],
    history: [],
    errors,
    coercions: [],
    mappingReport: [],
    sprintCoverage: emptyCoverage(),
  };
}

export {
  normalizeHeader,
  normalizeType,
  splitLabels,
  isRowEmpty,
  emptyResult,
  REQUIRED_HEADERS_KANBAN,
  REQUIRED_HEADERS_SCRUM,
};

import {
  Alert, Box, Button, Divider, FormHelperText, IconButton, InputAdornment, MenuItem,
  Paper, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  ArrowUpward as ArrowUpIcon,
  ArrowDownward as ArrowDownIcon,
  TableChart as TableIcon,
  BarChart as BarIcon,
} from '@mui/icons-material';
import { arrayMove } from '@dnd-kit/sortable';
import { CustomSectionRenderer } from './CustomSectionRenderer';
import { SortableRows, SortableRow, DragHandleCell } from '../SortableRows';
import {
  CATEGORY_TYPES, CHART_TYPES, COLUMN_TYPES, MAX_COLUMNS, MAX_ROWS,
  MAX_SECTIONS, MIN_COLUMNS, NUMERIC_TYPES, isChartConfigValid,
  makeColumnKey, makeSectionId,
} from './types';
import type { CustomChartConfig, CustomColumn, CustomColumnType, CustomSection } from './types';

interface Props {
  sections: CustomSection[];
  onChange: (sections: CustomSection[]) => void;
  getFieldError?: (path: string) => string | undefined;
  // When true, table rows can be reordered via drag-and-drop. Off by default;
  // the Delivery (Portfolio) presentation opts in.
  enableRowReorder?: boolean;
}

function emptySection(): CustomSection {
  const categoryKey = makeColumnKey();
  const valueKey = makeColumnKey();
  return {
    id: makeSectionId(),
    title: '',
    displayMode: 'table',
    columns: [
      { key: categoryKey, label: 'Category', type: 'text' },
      { key: valueKey, label: 'Count', type: 'number' },
    ],
    rows: [{ [categoryKey]: '', [valueKey]: null }],
  };
}

function emptyRow(columns: CustomColumn[]): Record<string, string | number | null> {
  const row: Record<string, string | number | null> = {};
  for (const col of columns) row[col.key] = null;
  return row;
}

export function CustomSectionsEditor({ sections, onChange, enableRowReorder = false, getFieldError }: Props) {
  const updateSection = (idx: number, patch: Partial<CustomSection> | ((s: CustomSection) => CustomSection)) => {
    onChange(sections.map((s, i) => {
      if (i !== idx) return s;
      return typeof patch === 'function' ? patch(s) : { ...s, ...patch };
    }));
  };

  const removeSection = (idx: number) => onChange(sections.filter((_, i) => i !== idx));

  const moveSection = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= sections.length) return;
    const copy = sections.slice();
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    onChange(copy);
  };

  const addSection = () => {
    if (sections.length >= MAX_SECTIONS) return;
    onChange([...sections, emptySection()]);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
        Add up to {MAX_SECTIONS} sections of project-specific data. Each section can be presented as a table or as a chart (bar, stacked bar, or line).
      </Alert>

      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">
          Sections: {sections.length} / {MAX_SECTIONS}
        </Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          variant="outlined"
          disabled={sections.length >= MAX_SECTIONS}
          onClick={addSection}
        >
          Add Section
        </Button>
      </Stack>

      {sections.length === 0 && (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', bgcolor: '#fafbfc' }}>
          <Typography variant="body2" color="text.secondary">
            No sections yet. Click "Add Section" to start.
          </Typography>
        </Paper>
      )}

      {sections.map((section, idx) => (
        <SectionCard
          key={section.id}
          section={section}
          index={idx}
          total={sections.length}
          enableRowReorder={enableRowReorder}
          onChange={(updater) => updateSection(idx, updater)}
          onRemove={() => removeSection(idx)}
          onMoveUp={() => moveSection(idx, -1)}
          onMoveDown={() => moveSection(idx, 1)}
          getFieldError={getFieldError}
        />
      ))}
    </Box>
  );
}

interface SectionCardProps {
  section: CustomSection;
  index: number;
  total: number;
  enableRowReorder: boolean;
  onChange: (updater: (s: CustomSection) => CustomSection) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  getFieldError?: (path: string) => string | undefined;
}

function SectionCard({ section, index, total, enableRowReorder, onChange, onRemove, onMoveUp, onMoveDown, getFieldError }: SectionCardProps) {
  const numericColumns = section.columns.filter(c => NUMERIC_TYPES.has(c.type));
  const categoryColumns = section.columns.filter(c => CATEGORY_TYPES.has(c.type));
  const chartReady = numericColumns.length >= 1 && categoryColumns.length >= 1;
  const chartValid = section.displayMode === 'chart' ? isChartConfigValid(section) : true;

  const setColumns = (next: CustomColumn[]) => onChange(s => ({ ...s, columns: next, rows: reconcileRows(s.rows, next) }));

  const addColumn = () => {
    if (section.columns.length >= MAX_COLUMNS) return;
    const key = makeColumnKey();
    setColumns([...section.columns, { key, label: `Column ${section.columns.length + 1}`, type: 'number' }]);
  };

  const removeColumn = (colIdx: number) => {
    if (section.columns.length <= MIN_COLUMNS) return;
    const removed = section.columns[colIdx];
    const nextCols = section.columns.filter((_, i) => i !== colIdx);
    onChange(s => {
      const nextRows = s.rows.map(row => {
        const copy = { ...row };
        delete copy[removed.key];
        return copy;
      });
      let chart = s.chart;
      if (chart) {
        const valueColumns = chart.valueColumns.filter(k => k !== removed.key);
        const categoryColumn = chart.categoryColumn === removed.key ? '' : chart.categoryColumn;
        chart = { ...chart, valueColumns, categoryColumn };
      }
      return { ...s, columns: nextCols, rows: nextRows, chart };
    });
  };

  const updateColumn = (colIdx: number, patch: Partial<CustomColumn>) => {
    const oldCol = section.columns[colIdx];
    const newCol = { ...oldCol, ...patch };
    const typeChanged = patch.type && patch.type !== oldCol.type;
    onChange(s => {
      const cols = s.columns.map((c, i) => (i === colIdx ? newCol : c));
      let rows = s.rows;
      if (typeChanged) {
        const nowNumeric = NUMERIC_TYPES.has(newCol.type);
        const wasNumeric = NUMERIC_TYPES.has(oldCol.type);
        if (nowNumeric !== wasNumeric) {
          rows = s.rows.map(r => {
            const v = r[newCol.key];
            if (v === null || v === undefined || v === '') return { ...r, [newCol.key]: null };
            if (nowNumeric) {
              const n = Number(v);
              return { ...r, [newCol.key]: Number.isFinite(n) ? n : null };
            }
            return { ...r, [newCol.key]: String(v) };
          });
        }
      }
      let chart = s.chart;
      if (chart && typeChanged) {
        if (chart.categoryColumn === newCol.key && !CATEGORY_TYPES.has(newCol.type)) {
          chart = { ...chart, categoryColumn: '' };
        }
        if (!NUMERIC_TYPES.has(newCol.type)) {
          const valueColumns = chart.valueColumns.filter(k => k !== newCol.key);
          chart = { ...chart, valueColumns };
        }
      }
      return { ...s, columns: cols, rows, chart };
    });
  };

  const setDisplayMode = (mode: 'table' | 'chart') => {
    onChange(s => {
      if (mode === 'table') return { ...s, displayMode: 'table' };
      const chart: CustomChartConfig = s.chart ?? {
        type: 'bar',
        categoryColumn: categoryColumns[0]?.key ?? '',
        valueColumns: numericColumns.map(c => c.key),
      };
      return { ...s, displayMode: 'chart', chart };
    });
  };

  const updateChart = (patch: Partial<CustomChartConfig>) => {
    onChange(s => {
      if (!s.chart) return s;
      return { ...s, chart: { ...s.chart, ...patch } };
    });
  };

  const toggleValueColumn = (key: string) => {
    onChange(s => {
      if (!s.chart) return s;
      const set = new Set(s.chart.valueColumns);
      if (set.has(key)) set.delete(key); else set.add(key);
      return { ...s, chart: { ...s.chart, valueColumns: Array.from(set) } };
    });
  };

  const addRow = () => {
    if (section.rows.length >= MAX_ROWS) return;
    onChange(s => ({ ...s, rows: [...s.rows, emptyRow(s.columns)] }));
  };

  const removeRow = (rowIdx: number) => {
    onChange(s => {
      const rows = s.rows.filter((_, i) => i !== rowIdx);
      return { ...s, rows: rows.length === 0 ? [emptyRow(s.columns)] : rows };
    });
  };

  // Insert a copy of the row directly below it, prepopulated from the source.
  const duplicateRow = (rowIdx: number) => {
    onChange(s => {
      if (s.rows.length >= MAX_ROWS) return s;
      const copy = { ...s.rows[rowIdx] };
      const rows = [...s.rows.slice(0, rowIdx + 1), copy, ...s.rows.slice(rowIdx + 1)];
      return { ...s, rows };
    });
  };

  const updateCell = (rowIdx: number, colKey: string, value: string | number | null) => {
    onChange(s => ({
      ...s,
      rows: s.rows.map((r, i) => i === rowIdx ? { ...r, [colKey]: value } : r),
    }));
  };

  const moveRow = (from: number, to: number) => {
    onChange(s => ({ ...s, rows: arrayMove(s.rows, from, to) }));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography variant="subtitle2" fontWeight={700} color="text.secondary">
            Section {index + 1}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.5}>
          <Tooltip title="Move up">
            <span>
              <IconButton size="small" disabled={index === 0} onClick={onMoveUp}>
                <ArrowUpIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Move down">
            <span>
              <IconButton size="small" disabled={index === total - 1} onClick={onMoveDown}>
                <ArrowDownIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Delete section">
            <IconButton size="small" color="error" onClick={onRemove}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          label="Title *"
          value={section.title}
          onChange={e => onChange(s => ({ ...s, title: e.target.value }))}
          size="small"
          fullWidth
          error={!!getFieldError?.(`customSections.${index}.title`) || !section.title.trim()}
          helperText={getFieldError?.(`customSections.${index}.title`) || (!section.title.trim() ? 'Title is required' : ' ')}
        />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={section.displayMode}
          onChange={(_, v) => v && setDisplayMode(v)}
          sx={{ alignSelf: { xs: 'stretch', md: 'flex-start' } }}
        >
          <ToggleButton value="table">
            <TableIcon fontSize="small" sx={{ mr: 0.5 }} /> Table
          </ToggleButton>
          <ToggleButton value="chart" disabled={!chartReady && section.displayMode !== 'chart'}>
            <BarIcon fontSize="small" sx={{ mr: 0.5 }} /> Chart
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {section.displayMode === 'chart' && !chartReady && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Add at least one number/percentage column and one text/date column to render a chart.
        </Alert>
      )}

      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        COLUMNS ({section.columns.length} / {MAX_COLUMNS})
      </Typography>
      <Stack spacing={1} sx={{ mb: 2 }}>
        {section.columns.map((col, ci) => (
          <Stack key={col.key} direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              value={col.label}
              onChange={e => updateColumn(ci, { label: e.target.value })}
              placeholder={`Column ${ci + 1}`}
              error={!!getFieldError?.(`customSections.${index}.columns.${ci}.label`)}
              helperText={getFieldError?.(`customSections.${index}.columns.${ci}.label`) || ' '}
              sx={{ flex: 1 }}
            />
            <Box>
              <Select
                size="small"
                value={col.type}
                error={!!getFieldError?.(`customSections.${index}.columns.${ci}.type`)}
                onChange={e => updateColumn(ci, { type: e.target.value as CustomColumnType })}
                sx={{ width: 150 }}
              >
                {COLUMN_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
              {getFieldError?.(`customSections.${index}.columns.${ci}.type`) && (
                <FormHelperText error>{getFieldError(`customSections.${index}.columns.${ci}.type`)}</FormHelperText>
              )}
            </Box>
            <IconButton
              size="small"
              onClick={() => removeColumn(ci)}
              disabled={section.columns.length <= MIN_COLUMNS}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Box>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={addColumn}
            disabled={section.columns.length >= MAX_COLUMNS}
          >
            Add Column
          </Button>
        </Box>
      </Stack>

      <Divider sx={{ my: 1.5 }} />

      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        ROWS ({section.rows.length} / {MAX_ROWS})
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
       <SortableRows enabled={enableRowReorder} count={section.rows.length} onReorder={moveRow}>
        <Table
          size="small"
          sx={{ width: '100%', tableLayout: 'fixed', minWidth: section.columns.length * 140 + 100 }}
        >
          <TableHead>
            <TableRow sx={{ bgcolor: '#f5f5f5' }}>
              {enableRowReorder && <TableCell sx={{ width: 36, px: 0.5 }} />}
              {section.columns.map(col => (
                // Fixed-width cells for the compact inputs (numbers, dates) so the
                // free-text columns absorb all remaining width instead of sitting
                // in a narrow box beside a wide empty cell.
                <TableCell
                  key={col.key}
                  sx={{
                    fontWeight: 700,
                    width: NUMERIC_TYPES.has(col.type) ? 120 : col.type === 'date' ? 190 : 'auto',
                    minWidth: 120,
                    wordBreak: 'break-word',
                  }}
                >
                  {col.label || '—'}
                </TableCell>
              ))}
              <TableCell sx={{ width: 88 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {section.rows.map((row, ri) => {
              const rowActions = (
                <>
                  {section.columns.map(col => (
                    <TableCell key={col.key}>
                      <RowCellInput
                        column={col}
                        value={row[col.key]}
                        errorMessage={getFieldError?.(`customSections.${index}.rows.${ri}.${col.key}`)}
                        onChange={(v) => updateCell(ri, col.key, v)}
                      />
                    </TableCell>
                  ))}
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title={section.rows.length >= MAX_ROWS ? `Max ${MAX_ROWS} rows` : 'Copy row'}>
                      <span>
                        <IconButton size="small" onClick={() => duplicateRow(ri)} disabled={section.rows.length >= MAX_ROWS}>
                          <CopyIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <IconButton size="small" onClick={() => removeRow(ri)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </>
              );
              if (!enableRowReorder) {
                return <TableRow key={ri}>{rowActions}</TableRow>;
              }
              return (
                <SortableRow key={ri} index={ri}>
                  {({ setNodeRef, style, dragHandleProps }) => (
                    <TableRow ref={setNodeRef} style={style}>
                      <DragHandleCell dragHandleProps={dragHandleProps} />
                      {rowActions}
                    </TableRow>
                  )}
                </SortableRow>
              );
            })}
          </TableBody>
        </Table>
       </SortableRows>
      </Box>
      <Button
        size="small"
        startIcon={<AddIcon />}
        onClick={addRow}
        disabled={section.rows.length >= MAX_ROWS}
        sx={{ mt: 1 }}
      >
        Add Row
      </Button>

      {section.displayMode === 'chart' && chartReady && section.chart && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            CHART CONFIGURATION
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <Select
              size="small"
              value={section.chart.type}
              error={!!getFieldError?.(`customSections.${index}.chart.type`)}
              onChange={e => updateChart({ type: e.target.value as CustomChartConfig['type'] })}
              sx={{ minWidth: 160 }}
            >
              {CHART_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </Select>
            <Select
              size="small"
              value={section.chart.categoryColumn}
              displayEmpty
              error={!!getFieldError?.(`customSections.${index}.chart.categoryColumn`)}
              onChange={e => updateChart({ categoryColumn: String(e.target.value) })}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="" disabled>Category column…</MenuItem>
              {categoryColumns.map(c => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
            </Select>
            {getFieldError?.(`customSections.${index}.chart.categoryColumn`) && (
              <FormHelperText error>{getFieldError(`customSections.${index}.chart.categoryColumn`)}</FormHelperText>
            )}
            <Box sx={{ flex: 1, minWidth: 240 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Value columns ({section.chart.valueColumns.length} selected)
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                {numericColumns.map(c => {
                  const active = section.chart!.valueColumns.includes(c.key);
                  return (
                    <Button
                      key={c.key}
                      size="small"
                      variant={active ? 'contained' : 'outlined'}
                      onClick={() => toggleValueColumn(c.key)}
                    >
                      {c.label}
                    </Button>
                  );
                })}
              </Stack>
              {getFieldError?.(`customSections.${index}.chart.valueColumns`) && (
                <FormHelperText error>{getFieldError(`customSections.${index}.chart.valueColumns`)}</FormHelperText>
              )}
            </Box>
          </Stack>
          {!chartValid && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Pick a category column and at least one value column to render the chart.
            </Alert>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Live preview
          </Typography>
          <Box sx={{ height: 280 }}>
            <CustomSectionRenderer section={section} variant="compact" height={260} />
          </Box>
        </>
      )}
    </Paper>
  );
}

function RowCellInput({ column, value, errorMessage, onChange }: {
  column: CustomColumn;
  value: string | number | null | undefined;
  errorMessage?: string;
  onChange: (v: string | number | null) => void;
}) {
  if (column.type === 'date') {
    return (
      <TextField
        type="date"
        size="small"
        error={!!errorMessage}
        helperText={errorMessage}
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        InputLabelProps={{ shrink: true }}
        sx={{ width: 170 }}
      />
    );
  }
  if (column.type === 'number' || column.type === 'percentage') {
    return (
      <TextField
        type="number"
        size="small"
        error={!!errorMessage}
        helperText={errorMessage}
        value={value ?? ''}
        onChange={e => {
          const v = e.target.value;
          if (v === '') return onChange(null);
          const n = Number(v);
          onChange(Number.isFinite(n) ? n : null);
        }}
        InputProps={column.type === 'percentage' ? {
          endAdornment: <InputAdornment position="end">%</InputAdornment>,
        } : undefined}
        sx={{ width: 100 }}
      />
    );
  }
  return (
    <TextField
      size="small"
      error={!!errorMessage}
      helperText={errorMessage}
      multiline
      minRows={1}
      maxRows={12}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      fullWidth
      sx={{ minWidth: 140 }}
    />
  );
}

function reconcileRows(rows: Array<Record<string, string | number | null>>, columns: CustomColumn[]): Array<Record<string, string | number | null>> {
  return rows.map(row => {
    const next: Record<string, string | number | null> = {};
    for (const c of columns) {
      next[c.key] = row[c.key] !== undefined ? row[c.key] : null;
    }
    return next;
  });
}

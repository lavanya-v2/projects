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

const ALLOWED_COLUMN_TYPES = new Set(['text', 'number', 'percentage', 'date']);
const NUMERIC_COLUMN_TYPES = new Set(['number', 'percentage']);
const CATEGORY_COLUMN_TYPES = new Set(['text', 'date']);
const ALLOWED_CHART_TYPES = new Set(['bar', 'stacked-bar', 'line']);

function fail(message: string): never {
    throw { status: 400, message };
}

export function validateCustomSections(input: unknown): CustomSection[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) fail('customSections must be an array');
    if (input.length > 12) fail('At most 12 custom sections are allowed per report');

    return input.map((raw: any, sectionIdx: number) => {
        const prefix = `customSections[${sectionIdx}]`;
        if (!raw || typeof raw !== 'object') fail(`${prefix} must be an object`);

        const title = typeof raw.title === 'string' ? raw.title.trim() : '';
        if (!title) fail(`${prefix}.title is required`);

        const displayMode = raw.displayMode;
        if (displayMode !== 'table' && displayMode !== 'chart') {
            fail(`${prefix}.displayMode must be "table" or "chart"`);
        }

        if (!Array.isArray(raw.columns) || raw.columns.length < 1 || raw.columns.length > 6) {
            fail(`${prefix}.columns must contain 1-6 columns`);
        }
        const seenKeys = new Set<string>();
        const columns = raw.columns.map((col: any, colIdx: number) => {
            const colPrefix = `${prefix}.columns[${colIdx}]`;
            if (!col || typeof col !== 'object') fail(`${colPrefix} must be an object`);
            if (typeof col.key !== 'string' || !col.key) fail(`${colPrefix}.key is required`);
            if (seenKeys.has(col.key)) fail(`${colPrefix}.key must be unique within the section`);
            seenKeys.add(col.key);
            const label = typeof col.label === 'string' ? col.label.trim() : '';
            if (!label) fail(`${colPrefix}.label is required`);
            if (!ALLOWED_COLUMN_TYPES.has(col.type)) {
                fail(`${colPrefix}.type must be one of text, number, percentage, date`);
            }
            return { key: col.key, label, type: col.type };
        });

        if (!Array.isArray(raw.rows) || raw.rows.length < 1 || raw.rows.length > 15) {
            fail(`${prefix}.rows must contain 1-15 rows`);
        }
        const rows = raw.rows.map((row: any, rowIdx: number) => {
            const rowPrefix = `${prefix}.rows[${rowIdx}]`;
            if (!row || typeof row !== 'object') fail(`${rowPrefix} must be an object`);
            const cleanRow: Record<string, string | number | null> = {};
            for (const col of columns) {
                const value = row[col.key];
                if (value === undefined || value === null || value === '') {
                    cleanRow[col.key] = null;
                    continue;
                }
                if (col.type === 'number' || col.type === 'percentage') {
                    const n = typeof value === 'number' ? value : Number(value);
                    cleanRow[col.key] = Number.isFinite(n) ? n : null;
                } else {
                    cleanRow[col.key] = String(value);
                }
            }
            return cleanRow;
        });

        let chart: CustomSection['chart'];
        if (displayMode === 'chart') {
            if (!raw.chart || typeof raw.chart !== 'object') {
                fail(`${prefix}.chart is required when displayMode is "chart"`);
            }
            if (!ALLOWED_CHART_TYPES.has(raw.chart.type)) {
                fail(`${prefix}.chart.type must be one of bar, stacked-bar, line`);
            }
            const colByKey = new Map(columns.map((c: { key: string; type: string }) => [c.key, c]));
            const categoryCol = colByKey.get(raw.chart.categoryColumn) as { type: string } | undefined;
            if (!categoryCol || !CATEGORY_COLUMN_TYPES.has(categoryCol.type)) {
                fail(`${prefix}.chart.categoryColumn must reference a text or date column`);
            }
            if (!Array.isArray(raw.chart.valueColumns) || raw.chart.valueColumns.length === 0) {
                fail(`${prefix}.chart.valueColumns must contain at least one column`);
            }
            for (const key of raw.chart.valueColumns) {
                const col = colByKey.get(key) as { type: string } | undefined;
                if (!col || !NUMERIC_COLUMN_TYPES.has(col.type)) {
                    fail(`${prefix}.chart.valueColumns must reference number or percentage columns`);
                }
            }
            chart = {
                type: raw.chart.type,
                categoryColumn: raw.chart.categoryColumn,
                valueColumns: [...raw.chart.valueColumns],
            };
        }

        const id = typeof raw.id === 'string' && raw.id ? raw.id : `sec_${Date.now()}_${sectionIdx}`;
        return { id, title, displayMode, columns, rows, ...(chart ? { chart } : {}) };
    });
}

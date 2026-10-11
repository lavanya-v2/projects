import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart,
  Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { ZeroAwareBarShape } from './CustomSectionRenderer';
import { CHART_PALETTE, NUMERIC_TYPES, formatCellValue, isChartConfigValid } from './types';
import type { CustomSection } from './types';

const sectionHeadingStyle = (color: string): React.CSSProperties => ({
  borderBottom: `2px solid ${color}`,
  paddingBottom: '4px',
  marginBottom: '10px',
  fontSize: '11px',
  fontWeight: 'bold',
  color,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
});

const HEADING_COLOR = '#00695c';

export function CustomSectionsPdfBlock({ sections, heading = 'Additional Insights' }: {
  sections: CustomSection[];
  heading?: string;
}) {
  if (!Array.isArray(sections) || sections.length === 0) return null;
  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={sectionHeadingStyle(HEADING_COLOR)}>{heading}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {sections.map((section, idx) => (
          <CustomSectionPdf key={section.id ?? idx} section={section} />
        ))}
      </div>
    </div>
  );
}

function CustomSectionPdf({ section }: { section: CustomSection }) {
  const useChart = section.displayMode === 'chart' && isChartConfigValid(section);
  return (
    <div style={{ border: '1px solid #cfd8dc', borderRadius: '4px', padding: '10px' }}>
      <div style={{ fontSize: '10px', fontWeight: 'bold', color: HEADING_COLOR, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {section.title}
      </div>
      {useChart ? <CustomChartPdf section={section} /> : <CustomTablePdf section={section} />}
    </div>
  );
}

function CustomTablePdf({ section }: { section: CustomSection }) {
  const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', verticalAlign: 'bottom', fontWeight: 'bold', borderBottom: '1px solid #b0bec5', color: '#37474f', fontSize: '10px', wordBreak: 'normal', overflowWrap: 'normal' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
      <thead>
        <tr style={{ background: '#eceff1' }}>
          {section.columns.map(col => (
            <th key={col.key} style={{ ...th, textAlign: NUMERIC_TYPES.has(col.type) ? 'center' : 'left' }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {section.rows.map((row, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? '#f5f7f9' : '#fff' }}>
            {section.columns.map(col => (
              <td
                key={col.key}
                style={{
                  padding: '5px 8px',
                  borderBottom: '1px solid #e8e8e8',
                  textAlign: NUMERIC_TYPES.has(col.type) ? 'center' : 'left',
                  fontVariantNumeric: NUMERIC_TYPES.has(col.type) ? 'tabular-nums' : 'normal',
                  wordBreak: 'normal',
                  overflowWrap: 'break-word',
                }}
              >
                {formatCellValue(row[col.key], col.type)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CustomChartPdf({ section }: { section: CustomSection }) {
  const chart = section.chart!;
  const colByKey = new Map(section.columns.map(c => [c.key, c]));
  const valueCols = chart.valueColumns
    .map(k => colByKey.get(k))
    .filter((c): c is NonNullable<typeof c> => !!c);
  const allPct = valueCols.length > 0 && valueCols.every(c => c.type === 'percentage');
  const data = section.rows.map(row => {
    const out: Record<string, string | number | null> = {
      __category: formatCellValue(row[chart.categoryColumn], colByKey.get(chart.categoryColumn)?.type ?? 'text'),
    };
    for (const c of valueCols) {
      const v = row[c.key];
      const n = typeof v === 'number' ? v : v == null || v === '' ? null : Number(v);
      out[c.label] = n != null && Number.isFinite(n) ? n : null;
    }
    return out;
  });

  // Match the on-screen renderer: force every tick and tilt them when there are
  // many categories, otherwise recharts drops the overlapping labels.
  const dense = data.length > 6;
  const W = 700, H = dense ? 250 : 200;
  const margin = { top: 4, right: 8, left: -20, bottom: 4 };
  const xAxisProps = {
    dataKey: '__category',
    tick: { fontSize: 9 },
    interval: 0 as const,
    ...(dense ? { angle: -35, textAnchor: 'end' as const, height: 55 } : {}),
  };

  if (chart.type === 'line') {
    return (
      <LineChart width={W} height={H} data={data} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis {...xAxisProps} />
        <YAxis tick={{ fontSize: 9 }} unit={allPct ? '%' : undefined} />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' own formatter type */}
        <RTooltip contentStyle={{ fontSize: 10 }} formatter={allPct ? (v: any) => `${v}%` : undefined} />
        <Legend wrapperStyle={{ fontSize: 9 }} />
        {valueCols.map((c, i) => (
          <Line key={c.key} type="monotone" dataKey={c.label}
            stroke={CHART_PALETTE[i % CHART_PALETTE.length]} strokeWidth={2} dot={{ r: 2 }} />
        ))}
      </LineChart>
    );
  }

  const stacked = chart.type === 'stacked-bar';
  // Mirrors the on-screen renderer's rule so the PDF and the slide agree.
  const showValues = !stacked && valueCols.length <= 2 && data.length <= 12;
  // Mirrors the on-screen renderer: a missing value in a labelled bar chart
  // reads as an explicit 0 on the baseline rather than a blank slot.
  const barData = showValues
    ? data.map(d => {
        const o = { ...d };
        for (const c of valueCols) if (o[c.label] == null) o[c.label] = 0;
        return o;
      })
    : data;
  return (
    <BarChart width={W} height={H} data={barData} margin={margin} barCategoryGap={stacked ? '20%' : '30%'} barGap={stacked ? 0 : 3}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
      <XAxis {...xAxisProps} />
      <YAxis tick={{ fontSize: 9 }} unit={allPct ? '%' : undefined} />
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' own formatter type */}
      <RTooltip contentStyle={{ fontSize: 10 }} formatter={allPct ? (v: any) => `${v}%` : undefined} />
      <Legend wrapperStyle={{ fontSize: 9 }} />
      {valueCols.map((c, i) => (
        <Bar key={c.key} dataKey={c.label}
          fill={CHART_PALETTE[i % CHART_PALETTE.length]}
          stackId={stacked ? 'a' : undefined}
          radius={[2, 2, 0, 0]}
          maxBarSize={stacked ? 48 : 34}
          shape={showValues ? ZeroAwareBarShape : undefined}>
          {showValues && (
            <LabelList
              dataKey={c.label}
              position="top"
              style={{ fontSize: 9, fontWeight: 600 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' own formatter type
              formatter={(v: any) => (allPct ? `${v}%` : `${v}`)}
            />
          )}
        </Bar>
      ))}
    </BarChart>
  );
}

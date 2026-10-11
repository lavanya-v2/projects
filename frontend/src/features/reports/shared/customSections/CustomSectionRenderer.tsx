import { Box, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart,
  Rectangle, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { CHART_PALETTE, formatCellValue, isChartConfigValid, NUMERIC_TYPES } from './types';
import type { CustomSection } from './types';

interface Props {
  section: CustomSection;
  height?: number;
  variant?: 'full' | 'compact';
}

export function CustomSectionRenderer({ section, height = 280, variant = 'full' }: Props) {
  const showTitle = variant === 'full' && !!section.title;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {showTitle && (
        <Typography variant="subtitle1" fontWeight={700} sx={{ color: '#0d1b2e', mb: 1.25 }}>
          {section.title}
        </Typography>
      )}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {section.displayMode === 'chart' && isChartConfigValid(section) ? (
          <ChartRender section={section} height={height} />
        ) : (
          <TableRender section={section} />
        )}
      </Box>
    </Paper>
  );
}

function TableRender({ section }: { section: CustomSection }) {
  return (
    <Box sx={{ width: '100%', overflowX: 'auto' }}>
    <Table
      size="small"
      sx={{
        width: '100%',
        '& th, & td': { whiteSpace: 'normal' },
        // Headers wrap only between words (never mid-word), so "ISSUE ID" stays
        // "ISSUE" / "ID" instead of "ISSU" / "E ID".
        '& th': { fontWeight: 700, bgcolor: '#f5f7fa', verticalAlign: 'bottom', wordBreak: 'normal', overflowWrap: 'normal' },
        // Body cells keep whole words intact, breaking only a single token that
        // can't fit on its own (e.g. a long id/URL) rather than every word.
        '& td': { wordBreak: 'normal', overflowWrap: 'break-word' },
      }}
    >
      <TableHead>
        <TableRow>
          {section.columns.map(col => (
            <TableCell key={col.key} align={NUMERIC_TYPES.has(col.type) ? 'center' : 'left'}>
              {col.label}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {section.rows.map((row, i) => (
          <TableRow key={i}>
            {section.columns.map(col => (
              <TableCell
                key={col.key}
                align={NUMERIC_TYPES.has(col.type) ? 'center' : 'left'}
                sx={{ fontVariantNumeric: NUMERIC_TYPES.has(col.type) ? 'tabular-nums' : undefined }}
              >
                {formatCellValue(row[col.key], col.type)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </Box>
  );
}

// recharts discards zero-height bar rectangles before they reach LabelList, so a
// 0 value would silently render neither a bar nor its "0" label. Supplying any
// custom shape opts the series out of that filter (Bar's `hasCustomShape`), which
// keeps the entry alive so the label draws on the baseline; the bar itself stays
// invisible because we render nothing when there is no height.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' own shape-props type
export function ZeroAwareBarShape(props: any) {
  return props.height ? <Rectangle {...props} /> : null;
}

function ChartRender({ section, height }: { section: CustomSection; height: number }) {
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

  // With many categories recharts silently drops overlapping X-axis ticks. Force
  // every tick to render and tilt them so all labels stay visible.
  const dense = data.length > 6;
  const xAxisProps = {
    dataKey: '__category',
    tick: { fontSize: 10 },
    interval: 0 as const,
    ...(dense ? { angle: -35, textAnchor: 'end' as const, height: 58 } : {}),
  };

  const margin = { top: 8, right: 12, left: -8, bottom: dense ? 8 : 4 };
  const tooltipStyle = { borderRadius: 8, fontSize: 12 };
  const legendStyle = { fontSize: 11 };

  if (chart.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={margin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis {...xAxisProps} />
          <YAxis tick={{ fontSize: 10 }} unit={allPct ? '%' : undefined} />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' own formatter type */}
          <RTooltip contentStyle={tooltipStyle} formatter={allPct ? (v: any) => `${v}%` : undefined} />
          <Legend wrapperStyle={legendStyle} />
          {valueCols.map((c, i) => (
            <Line
              key={c.key}
              type="monotone"
              dataKey={c.label}
              stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  const stacked = chart.type === 'stacked-bar';
  // On-bar values only while the chart stays uncluttered: at most two series per
  // category, never stacked, and few enough categories that the labels don't
  // collide. Matches the tooltip's formatting so the two never disagree.
  const showValues = !stacked && valueCols.length <= 2 && data.length <= 12;
  // A missing value in a labelled bar chart must read as an explicit 0 on the
  // baseline, not as a blank slot — recharts draws neither bar nor label for a
  // null. Only applied where value labels are shown; unlabelled/stacked charts
  // and line charts keep genuine gaps.
  const barData = showValues
    ? data.map(d => {
        const o = { ...d };
        for (const c of valueCols) if (o[c.label] == null) o[c.label] = 0;
        return o;
      })
    : data;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={barData} margin={margin} barCategoryGap={stacked ? '20%' : '30%'} barGap={stacked ? 0 : 3}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="__category" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} unit={allPct ? '%' : undefined} />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' own formatter type */}
        <RTooltip contentStyle={tooltipStyle} formatter={allPct ? (v: any) => `${v}%` : undefined} />
        <Legend wrapperStyle={legendStyle} />
        {valueCols.map((c, i) => (
          <Bar
            key={c.key}
            dataKey={c.label}
            fill={CHART_PALETTE[i % CHART_PALETTE.length]}
            stackId={stacked ? 'a' : undefined}
            radius={[3, 3, 0, 0]}
            maxBarSize={stacked ? 48 : 34}
            shape={showValues ? ZeroAwareBarShape : undefined}
          >
            {showValues && (
              <LabelList
                dataKey={c.label}
                position="top"
                style={{ fontSize: 10, fontWeight: 600 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' own formatter type
                formatter={(v: any) => (allPct ? `${v}%` : `${v}`)}
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

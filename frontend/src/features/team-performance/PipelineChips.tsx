import { Box, Chip } from '@mui/material';
import {
  PIPELINE_STATUS_ORDER,
  PIPELINE_STATUS_STYLES,
  type PipelineStatusKey,
} from './perfConstants';

interface Breakdown {
  done?: number;
  inUat?: number;
  inQa?: number;
  inReview?: number;
  inProgress?: number;
  blocked?: number;
  todo?: number;
}

/** Reusable pipeline breakdown chips (compact variant for dashboard cards) */
export function PipelineChips({
  bd,
  compact = false,
}: {
  bd: Breakdown | null | undefined;
  compact?: boolean;
}) {
  if (!bd) return null;
  const fontSize = compact ? 10 : 11;

  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {PIPELINE_STATUS_ORDER.map((key: PipelineStatusKey) => {
        const count = bd[key] ?? 0;
        if (count <= 0) return null;
        const style = PIPELINE_STATUS_STYLES[key];
        return (
          <Chip
            key={key}
            label={`${count} ${style.label}`}
            size="small"
            sx={{
              bgcolor: style.bg,
              color: style.fg,
              fontWeight: 600,
              fontSize,
            }}
          />
        );
      })}
    </Box>
  );
}

import { Box, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

/** Small info affordance: a hover/tap tooltip explaining what a metric or chart means. */
export function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip title={text} arrow enterTouchDelay={0} leaveTouchDelay={4000}>
      <InfoOutlinedIcon
        sx={{ fontSize: 15, color: '#94a3b8', ml: 0.5, verticalAlign: 'middle', cursor: 'help' }}
      />
    </Tooltip>
  );
}

export function Kpi({
  value,
  label,
  color,
  info,
  highlight,
}: {
  value: string;
  label: string;
  color?: string;
  info?: string;
  /** Draws attention to a tile that needs action (amber border + tinted background). */
  highlight?: boolean;
}) {
  return (
    <Box
      sx={{
        bgcolor: highlight ? '#fff8e1' : '#f8fafc',
        border: `1px solid ${highlight ? '#ffb74d' : '#e2e8f0'}`,
        borderRadius: 2,
        p: 1.5,
        textAlign: 'center',
      }}
    >
      <Typography sx={{ fontSize: 24, fontWeight: 800, color: color ?? 'text.primary', lineHeight: 1.2 }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
        {label}
        {info && <InfoHint text={info} />}
      </Typography>
    </Box>
  );
}

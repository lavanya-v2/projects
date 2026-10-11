import { Box } from '@mui/material';
import { barFill } from './perfColors';

/** Colored circle score badge — replaces per-metric chips */
export function ScoreBadge({ score }: { score: number }) {
  return (
    <Box
      sx={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        bgcolor: barFill(score),
        color: 'white',
        fontWeight: 700,
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        mx: 'auto',
      }}
    >
      {Math.round(score)}
    </Box>
  );
}

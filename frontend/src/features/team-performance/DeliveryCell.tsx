import { Box, LinearProgress, Typography } from '@mui/material';
import { deliveryColor, deliveryHex } from './perfColors';

/** Delivery progress bar + number — replaces Chip for delivery % */
export function DeliveryCell({ pct }: { pct: number }) {
  return (
    <Box sx={{ minWidth: 80 }}>
      <LinearProgress
        variant="determinate"
        value={Math.min(pct, 100)}
        color={deliveryColor(pct)}
        sx={{ height: 7, borderRadius: 4, mb: 0.3 }}
      />
      <Typography variant="caption" fontWeight={700} sx={{ color: deliveryHex(pct) }}>
        {pct.toFixed(1)}%
      </Typography>
    </Box>
  );
}

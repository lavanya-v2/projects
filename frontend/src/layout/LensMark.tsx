import { brandColors } from '../theme/tokens';

interface LensMarkProps {
  size?: number;
}

/** Brand logo — three concentric circles in the brand orange. */
export const LensMark = ({ size = 26 }: LensMarkProps) => (
  <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="28" cy="28" r="26" stroke={brandColors.orange} strokeWidth="3" fill="none" />
    <circle cx="28" cy="28" r="16" stroke={brandColors.orange} strokeWidth="2.5" fill="none" opacity="0.7" />
    <circle cx="28" cy="28" r="7" fill={brandColors.orange} />
  </svg>
);

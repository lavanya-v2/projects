import { Typography } from '@mui/material';
import { stripRiskLines } from '../../utils/stripRiskLines';
import { BulletItem } from './BulletItem';

interface RiskBulletsProps {
    text: string;
    color: string;
}

/** Renders a text block as dot-bullet lines with emoji/markdown stripped. */
export const RiskBullets = ({ text, color }: RiskBulletsProps) => {
    const lines = stripRiskLines(text);
    if (!lines.length) {
        return <Typography variant="body2" color="text.secondary">None identified.</Typography>;
    }
    return (
        <>
            {lines.map((line, i) => (
                <BulletItem key={i} text={line} color={color} />
            ))}
        </>
    );
};

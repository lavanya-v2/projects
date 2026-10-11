import { useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
    TextField,
    Button,
    Box,
    Alert,
    CircularProgress,
    Typography,
    InputAdornment,
    IconButton,
} from '@mui/material';
import {
    Visibility,
    VisibilityOff,
    CheckCircleOutline,
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';

const NAVY = '#002e5b';
const ORANGE = '#f15a24';

const LensAperture = ({ size = 56 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="28" cy="28" r="26" stroke={ORANGE} strokeWidth="2.5" fill="none" />
        <circle cx="28" cy="28" r="17" stroke={ORANGE} strokeWidth="2" fill="none" opacity="0.7" />
        <circle cx="28" cy="28" r="8" fill={ORANGE} opacity="0.9" />
        <line x1="28" y1="2" x2="28" y2="14" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="28" y1="42" x2="28" y2="54" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="2" y1="28" x2="14" y2="28" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="42" y1="28" x2="54" y2="28" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
    </svg>
);

const features = [
    'Real-time project reporting',
    'Cross-account visibility',
    'Automated presentations',
    'Team delivery analytics',
];

export const Login = () => {
    const [userId, setUserId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const location = useLocation();
    const sessionExpired = useMemo(
        () => new URLSearchParams(location.search).get('expired') === 'true',
        [location.search]
    );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(userId, password);
        } catch (err: any) {
            const errorMsg = err.response?.data?.error || 'Invalid credentials. Please try again.';
            setError(errorMsg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ minHeight: '100vh', display: 'flex' }}>
            {/* ── Left panel: branding ──────────────────────────── */}
            <Box
                sx={{
                    display: { xs: 'none', md: 'flex' },
                    flexDirection: 'column',
                    width: '42%',
                    flexShrink: 0,
                    bgcolor: NAVY,
                    px: 6,
                    py: 5,
                    position: 'relative',
                    overflow: 'hidden',
                    justifyContent: 'space-between',
                }}
            >
                {/* Subtle radial glow */}
                <Box sx={{
                    position: 'absolute',
                    width: 480,
                    height: 480,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(108,152,225,0.18) 0%, transparent 70%)',
                    bottom: -120,
                    left: -80,
                    pointerEvents: 'none',
                }} />

                {/* Top: logo */}
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                        <LensAperture size={36} />
                        <Typography sx={{
                            fontFamily: 'Poppins, sans-serif',
                            fontWeight: 700,
                            fontSize: 26,
                            color: '#fff',
                            letterSpacing: -0.5,
                            lineHeight: 1,
                        }}>
                            Lens
                        </Typography>
                    </Box>
                    <Typography sx={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.45)',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        ml: '52px',
                        mt: '-4px',
                    }}>
                        by V2Solutions
                    </Typography>
                </Box>

                {/* Center: hero copy */}
                <Box>
                    <Typography sx={{
                        fontFamily: 'Poppins, sans-serif',
                        fontWeight: 600,
                        fontSize: 28,
                        color: '#fff',
                        lineHeight: 1.35,
                        mb: 1.5,
                        maxWidth: 300,
                    }}>
                        Clarity in every project.
                    </Typography>
                    <Typography sx={{
                        fontFamily: 'Inter, sans-serif',
                        fontWeight: 300,
                        fontSize: 15,
                        color: 'rgba(255,255,255,0.65)',
                        lineHeight: 1.6,
                        maxWidth: 280,
                        mb: 4,
                    }}>
                        Enterprise reporting that keeps every team aligned.
                    </Typography>

                    {/* Feature callouts */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {features.map(f => (
                            <Box key={f} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                                <CheckCircleOutline sx={{ fontSize: 16, color: ORANGE, flexShrink: 0 }} />
                                <Typography sx={{
                                    fontFamily: 'Inter, sans-serif',
                                    fontSize: 13,
                                    color: 'rgba(255,255,255,0.65)',
                                }}>
                                    {f}
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                </Box>

                {/* Bottom: legal */}
                <Typography sx={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.25)',
                }}>
                    © {new Date().getFullYear()} V2Solutions. All rights reserved.
                </Typography>
            </Box>

            {/* ── Right panel: form ─────────────────────────────── */}
            <Box
                sx={{
                    flex: 1,
                    bgcolor: '#f4f6f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    px: { xs: 3, sm: 6 },
                    py: 6,
                }}
            >
                <Box sx={{ width: '100%', maxWidth: 380 }}>
                    {/* Mobile logo */}
                    <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1.5, mb: 4 }}>
                        <LensAperture size={28} />
                        <Typography sx={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 20, color: NAVY }}>
                            Lens
                        </Typography>
                    </Box>

                    <Typography sx={{
                        fontFamily: 'Poppins, sans-serif',
                        fontWeight: 600,
                        fontSize: 26,
                        color: NAVY,
                        mb: 0.5,
                    }}>
                        Welcome back
                    </Typography>
                    <Typography sx={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 14,
                        color: '#6b7280',
                        mb: 4,
                    }}>
                        Sign in to your workspace
                    </Typography>

                    {sessionExpired && !error && (
                        <Alert severity="warning" sx={{ mb: 3, borderRadius: 2, fontSize: 13 }}>
                            Your session has expired. Please sign in again.
                        </Alert>
                    )}

                    {error && (
                        <Alert severity="error" sx={{ mb: 3, borderRadius: 2, fontSize: 13 }}>
                            {error}
                        </Alert>
                    )}

                    <Box component="form" onSubmit={handleSubmit}>
                        {/* Username label + field */}
                        <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#374151', mb: 0.75 }}>
                            Username
                        </Typography>
                        <TextField
                            fullWidth
                            placeholder="Enter your username"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            required
                            autoFocus
                            disabled={loading}
                            variant="outlined"
                            sx={inputSx}
                        />

                        <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#374151', mb: 0.75, mt: 2.5 }}>
                            Password
                        </Typography>
                        <TextField
                            fullWidth
                            placeholder="Enter your password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            disabled={loading}
                            variant="outlined"
                            InputProps={{
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            onClick={() => setShowPassword(v => !v)}
                                            edge="end"
                                            size="small"
                                            sx={{ color: '#9ca3af' }}
                                        >
                                            {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                            sx={inputSx}
                        />

                        <Button
                            type="submit"
                            fullWidth
                            variant="contained"
                            disabled={loading}
                            sx={{
                                mt: 4,
                                height: 48,
                                bgcolor: ORANGE,
                                fontFamily: 'Poppins, sans-serif',
                                fontWeight: 600,
                                fontSize: 15,
                                textTransform: 'none',
                                borderRadius: 2,
                                letterSpacing: 0,
                                boxShadow: 'none',
                                '&:hover': {
                                    bgcolor: '#d44e1f',
                                    boxShadow: '0 4px 12px rgba(241,90,36,0.35)',
                                },
                                '&:active': { transform: 'scale(0.98)' },
                                '&.Mui-disabled': { bgcolor: '#f8c4ac', color: '#fff' },
                                transition: 'all 0.15s ease',
                            }}
                        >
                            {loading ? <CircularProgress size={22} sx={{ color: '#fff' }} /> : 'Sign In'}
                        </Button>
                    </Box>

                    <Typography sx={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 12,
                        color: '#9ca3af',
                        textAlign: 'center',
                        mt: 4,
                    }}>
                        Having trouble? Contact your administrator.
                    </Typography>
                </Box>
            </Box>
        </Box>
    );
};

const inputSx = {
    '& .MuiOutlinedInput-root': {
        borderRadius: 2,
        bgcolor: '#fff',
        fontFamily: 'Inter, sans-serif',
        fontSize: 14,
        '& fieldset': { borderColor: '#d1d5db' },
        '&:hover fieldset': { borderColor: '#9ca3af' },
        '&.Mui-focused fieldset': {
            borderColor: '#002e5b',
            borderWidth: '1.5px',
        },
    },
    '& input': {
        py: '13px',
        px: '14px',
    },
    '& .MuiInputLabel-root': { display: 'none' },
};

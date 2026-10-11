import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { lightPalette, darkPalette, typography, shape, brandColors } from './tokens';
import { getComponentOverrides } from './components';

export const lightTheme: Theme = createTheme({
  palette: { mode: 'light', ...lightPalette },
  typography,
  shape,
  components: getComponentOverrides('light'),
});

export const darkTheme: Theme = createTheme({
  palette: { mode: 'dark', ...darkPalette },
  typography,
  shape,
  components: getComponentOverrides('dark'),
});

export const getTheme = (mode: 'light' | 'dark'): Theme =>
  mode === 'dark' ? darkTheme : lightTheme;

export { brandColors };

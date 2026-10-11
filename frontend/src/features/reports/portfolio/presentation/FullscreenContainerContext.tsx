import { createContext, useContext } from 'react';

// The DOM node PortfolioPresentation puts into native Fullscreen API mode.
// MUI Dialog/Popover/Snackbar portal to document.body by default, which sits
// outside the fullscreen element and is not painted while fullscreen is
// engaged — any component within the presentation tree that renders one of
// these must target this container instead.
export const FullscreenContainerContext = createContext<HTMLElement | null>(null);

export function useFullscreenContainer(): HTMLElement | undefined {
  return useContext(FullscreenContainerContext) ?? undefined;
}

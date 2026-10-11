/**
 * Shared navigation helpers for the new "Lens" UI icon-rail layout.
 *
 * The new shell renders the left rail as <div aria-label="Section">; clicking
 * a section icon opens a sub-panel that contains the leaf navigation labels
 * (Daily Reports, Action Items, Risk Board, etc). Tests should never click
 * `text=…` directly for nav — use these helpers so the structure is encoded
 * in one place.
 *
 * Probed via debug spec: rail items have NO role="button", only aria-label.
 * Sub-panel leaf items are plain Box with text content.
 */

import type { Page } from '@playwright/test';

export type RailSection = 'Dashboard' | 'Reports' | 'Presentation' | 'Management' | 'Administration';

export type LeafLabel =
    | 'Daily Reports'
    | 'Weekly Project'
    | 'Weekly Account'
    | 'Monthly Project'
    | 'Monthly Account'
    | 'Bi-Weekly Status'
    | 'Sprint Data'
    | 'Team Performance'
    | 'Action Items'
    | 'Risk Board';

const SECTION_OF_LABEL: Record<LeafLabel, Exclude<RailSection, 'Dashboard' | 'Administration'>> = {
    'Daily Reports': 'Reports',
    'Weekly Project': 'Reports',
    'Weekly Account': 'Reports',
    'Monthly Project': 'Reports',
    'Monthly Account': 'Reports',
    'Bi-Weekly Status': 'Presentation',
    'Sprint Data': 'Presentation',
    'Team Performance': 'Management',
    'Action Items': 'Management',
    'Risk Board': 'Management',
};

/**
 * Click a top-level section icon on the left rail.
 *
 * - Dashboard / Administration navigate directly (no sub-panel)
 * - Reports / Presentation / Management open a sub-panel containing leaf items
 */
export async function openRailSection(page: Page, section: RailSection): Promise<void> {
    await page.locator(`[aria-label="${section}"]`).first().click();
    await page.waitForTimeout(300);
}

/**
 * Navigate to a leaf nav item (e.g. "Risk Board", "Action Items"):
 *   1. Click the parent section's rail icon
 *   2. Click the leaf label inside the now-visible sub-panel
 *
 * Throws if the leaf label is not visible after the section opens (use
 * `isLeafNavVisible` first if you need a soft probe).
 */
export async function navigateTo(page: Page, label: LeafLabel): Promise<void> {
    const section = SECTION_OF_LABEL[label];
    await openRailSection(page, section);
    // Wait for the leaf label to appear in the sub-panel, then click it.
    await page.locator(`text=${label}`).first().waitFor({ state: 'visible', timeout: 5000 });
    await page.locator(`text=${label}`).first().click();
    await page.waitForTimeout(500);
}

/**
 * Check whether a top-level rail section is visible (used for role-gated tests
 * like "manager does NOT see Administration").
 */
export async function isRailSectionVisible(page: Page, section: RailSection): Promise<boolean> {
    return page.locator(`[aria-label="${section}"]`).first().isVisible({ timeout: 1000 }).catch(() => false);
}

/**
 * Check whether a leaf nav label is reachable for the current user. Opens the
 * parent section first; returns false if the section is not visible OR the
 * leaf is not present in the sub-panel.
 */
export async function isLeafNavVisible(page: Page, label: LeafLabel): Promise<boolean> {
    const section = SECTION_OF_LABEL[label];
    const sectionVisible = await isRailSectionVisible(page, section);
    if (!sectionVisible) return false;
    try {
        await openRailSection(page, section);
    } catch {
        return false;
    }
    return page.locator(`text=${label}`).first().isVisible({ timeout: 1000 }).catch(() => false);
}

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { config } from '../../../config';
import { collectorAuthService } from '../services/collectorAuthService';

/**
 * The collector's version is declared once, in COLLECTOR_VERSION in
 * tools/claude-usage-collector/collector.js, and everything else reads it from
 * there — the served release comes from collectorAuthService.currentCollectorVersion,
 * which parses that same file.
 *
 * The one thing that is NOT derived is knownCollectorVersions, the list of releases
 * the server recognises, and that is where drift happens. It happened already: 1.3.0
 * shipped on 20 Aug while the list still stopped at 1.2.0, so every upgraded machine
 * was quietly flagged 'unknown-collector' in Data Quality and nobody noticed.
 *
 * The stakes are higher now. An unlisted current version means genuine flags get
 * buried under noise, and the flags that matter here are the ones saying a report
 * was sent from a machine with no VPN gate.
 *
 * So this test does the remembering instead of a release checklist.
 */
describe('collector version', () => {
    const collectorJs = path.join(__dirname, '../../../../../tools/claude-usage-collector/collector.js');

    const declaredVersion = (): string => {
        const src = fs.readFileSync(collectorJs, 'utf8');
        const m = /const COLLECTOR_VERSION = '([^']+)'/.exec(src);
        if (!m) throw new Error(`COLLECTOR_VERSION not found in ${collectorJs}`);
        return m[1];
    };

    it('is readable from collector.js by the server', () => {
        // Guards the parsing itself: if COLLECTOR_VERSION is ever reformatted so the
        // regex misses it, the served version silently becomes null and the
        // out-of-date banner switches off for everyone with no other symptom.
        expect(collectorAuthService.currentCollectorVersion()).toBe(declaredVersion());
    });

    it('is listed in knownCollectorVersions', () => {
        // Missing here means every report from an up-to-date machine is flagged
        // 'unknown-collector' — non-blocking, but it buries the flags that matter.
        expect(config.collector.integrity.knownCollectorVersions).toContain(declaredVersion());
    });

    it('is the newest entry in knownCollectorVersions', () => {
        // Catches a version added to the list without the collector actually being
        // bumped, and vice versa — either way the list and the file have diverged.
        const parts = (v: string) => v.split('.').map(Number);
        const newest = [...config.collector.integrity.knownCollectorVersions].sort((a, b) => {
            const [aMaj, aMin, aPat] = parts(a);
            const [bMaj, bMin, bPat] = parts(b);
            return aMaj - bMaj || aMin - bMin || aPat - bPat;
        }).pop();
        expect(declaredVersion()).toBe(newest);
    });
});

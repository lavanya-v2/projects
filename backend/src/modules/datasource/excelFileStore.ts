import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';

/**
 * Retention of uploaded Excel/CSV files.
 *
 * Previously every upload wrote to uploads/projects/<id>/<ext>/template.xlsx AFTER deleting every
 * file in that folder -- so only the most recent upload survived, keyed by neither date nor sprint.
 * Nothing ever read it back either. That directory wipe is the direct cause of "files uploaded for
 * the same date get overwritten".
 *
 * Files are now keyed by import id, so every upload is retained and downloadable, and nothing can
 * clobber anything.
 */

export interface StoredFile {
    storagePath: string;
    fileSize: number;
    checksum: string;
    mimeType?: string;
}

const MIME_BY_EXT: Record<string, string> = {
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
};

export function checksumOf(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeExtension(originalName?: string): string {
    const ext = path.extname(originalName ?? '').toLowerCase();
    return ['.xlsx', '.xls', '.csv'].includes(ext) ? ext : '.xlsx';
}

/** Absolute path for one import's retained file. */
export function importFilePath(projectId: number, importId: number, originalName?: string): string {
    return path.join(
        config.uploads.path,
        'projects',
        String(projectId),
        'imports',
        `${importId}${safeExtension(originalName)}`
    );
}

/**
 * Persist an uploaded file against its import. Called only after validation succeeds and the import
 * row exists, so a filesystem failure can never destroy an otherwise-valid import and invalid files
 * never land on disk.
 */
export function storeImportFile(
    projectId: number,
    importId: number,
    buffer: Buffer,
    originalName?: string
): StoredFile {
    const filePath = importFilePath(projectId, importId, originalName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);

    return {
        storagePath: filePath,
        fileSize: buffer.length,
        checksum: checksumOf(buffer),
        mimeType: MIME_BY_EXT[safeExtension(originalName)],
    };
}

/**
 * Persist the sample workbook a column mapping was defined from.
 *
 * Keyed by mapping id, not a fixed `sample` name: each mapping version keeps the file it was
 * actually built from, so an import parsed under an older mapping can still be traced back to the
 * sample that defined it.
 */
export function storeMappingSample(
    projectId: number,
    mappingId: number,
    buffer: Buffer,
    originalName?: string
): StoredFile {
    const filePath = path.join(
        config.uploads.path,
        'projects',
        String(projectId),
        'mapping',
        `${mappingId}${safeExtension(originalName)}`
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);

    return {
        storagePath: filePath,
        fileSize: buffer.length,
        checksum: checksumOf(buffer),
        mimeType: MIME_BY_EXT[safeExtension(originalName)],
    };
}

export function readStoredFile(storagePath?: string | null): Buffer | null {
    if (!storagePath || !fs.existsSync(storagePath)) {
        return null;
    }

    return fs.readFileSync(storagePath);
}

export function removeStoredFile(storagePath?: string | null): void {
    try {
        if (storagePath && fs.existsSync(storagePath)) {
            fs.unlinkSync(storagePath);
        }
    } catch {
        // A retained file that cannot be removed must not block deleting the import record.
    }
}

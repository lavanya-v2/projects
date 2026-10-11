import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { authenticate, checkPermission } from '../../middleware/authMiddleware';
import { handleUploadErrors } from '../../common/uploadMiddleware';
import { excelImportController } from './excelImportController';

export const dataSourceRoutes = Router();

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  // The route's :ext param describes the endpoint, not the payload; without this nothing checked
  // what was actually uploaded.
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
      return;
    }

    cb(new Error('Only .xlsx, .xls and .csv files are supported'));
  },
});

// Template download (any authenticated user)
dataSourceRoutes.get('/excel/template/:template', authenticate, (req, res) =>
  excelImportController.downloadTemplate(req, res)
);

/*
 * Read a sample file's headers and propose a column mapping for them.
 *
 * Deliberately project-agnostic: a mapping is now built while CREATING a project, before a project
 * id exists. Writes nothing and reads headers only, so it needs no project permission check.
 */
dataSourceRoutes.post('/mapping/suggest', authenticate, handleUploadErrors(upload.single('file')), (req, res) =>
  excelImportController.suggestMapping(req, res)
);

// Validate (dry-run, no DB writes; no project context required)
dataSourceRoutes.post('/:ext/validate', authenticate, handleUploadErrors(upload.single('file')), (req, res) =>
  excelImportController.validate(req, res)
);

// Dry-run impact diff against already-imported data. Writes nothing.
dataSourceRoutes.post(
  '/projects/:projectId/:ext/imports/preview',
  authenticate,
  checkPermission,
  handleUploadErrors(upload.single('file')),
  (req, res) => excelImportController.preview(req, res)
);

// Project-scoped upload + apply: checkPermission enforces project access
dataSourceRoutes.post(
  '/projects/:projectId/:ext/imports',
  authenticate,
  checkPermission,
  handleUploadErrors(upload.single('file')),
  (req, res) => excelImportController.upload(req, res)
);

// Sprints known to the project, for the upload form's sprint picker.
dataSourceRoutes.get('/projects/:projectId/sprints', authenticate, checkPermission, (req, res) =>
  excelImportController.listSprints(req, res)
);

// Rename / merge sprints, then replay the projection.
dataSourceRoutes.post('/projects/:projectId/sprints/rename', authenticate, checkPermission, (req, res) =>
  excelImportController.renameSprints(req, res)
);

// Project-scoped list: checkPermission enforces project access
dataSourceRoutes.get('/projects/:projectId/excel/imports/:page/:limit', authenticate, checkPermission, (req, res) =>
  excelImportController.list(req, res)
);

/*
 * Per-import detail. These are nested under the project so checkPermission can apply -- previously
 * GET/DELETE were keyed on the import id alone with only `authenticate`, so any signed-in user
 * could read or delete any project's import.
 */
dataSourceRoutes.get('/projects/:projectId/imports/:id/rows', authenticate, checkPermission, (req, res) =>
  excelImportController.rows(req, res)
);
dataSourceRoutes.get('/projects/:projectId/imports/:id/file', authenticate, checkPermission, (req, res) =>
  excelImportController.downloadFile(req, res)
);
dataSourceRoutes.post('/projects/:projectId/imports/:id/resubmit', authenticate, checkPermission, (req, res) =>
  excelImportController.resubmit(req, res)
);
dataSourceRoutes.delete('/projects/:projectId/imports/:id', authenticate, checkPermission, (req, res) =>
  excelImportController.delete(req, res)
);

// Legacy id-only detail route, retained for the adapter/debug path.
dataSourceRoutes.get('/excel/imports/:id', authenticate, (req, res) => excelImportController.get(req, res));

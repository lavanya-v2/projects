import { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';

/**
 * Run a multer handler and turn its rejections into a 400 the user can act on.
 *
 * Multer reports a rejected file by calling `next(err)`, which fell through to the global handler
 * and came back as a bare 500 "Internal Server Error" -- so picking a .pdf by mistake looked like
 * the server had broken rather than like a file the app does not accept.
 */
export const handleUploadErrors =
  (uploader: RequestHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    uploader(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof multer.MulterError) {
        res.status(400).json({
          error:
            err.code === 'LIMIT_FILE_SIZE'
              ? 'That file is larger than the 20 MB upload limit.'
              : `Upload rejected: ${err.message}`,
        });
        return;
      }

      res.status(400).json({ error: err instanceof Error ? err.message : 'Upload rejected' });
    });
  };

import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { createGzip } from 'zlib';
import multer from 'multer';
import tar from 'tar-stream';
import { requireAuth } from '../auth/middleware.js';
import { getSession } from '../sessions/session-service.js';
import { injectFiles, extractWorkspace, validateTarStream } from './stream-service.js';
import { getConfig } from '../config.js';

export const uploadRouter = Router();

function getUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: getConfig().uploads.max_file_size },
  });
}

// ---------------------------------------------------------------------------
// POST /:id/upload — upload files (tar/tar.gz) into a session's container
// ---------------------------------------------------------------------------

uploadRouter.post(
  '/:id/upload',
  requireAuth,
  (req, res, next) => getUpload().single('file')(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const session = await getSession(req.params.id as string, userId);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (session.status !== 'active' && session.status !== 'creating') {
        res.status(400).json({ error: `Cannot upload to session with status "${session.status}"` });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No file provided. Upload a tar or tar.gz file as the "file" field.' });
        return;
      }

      const filename = req.file.originalname.toLowerCase();
      const isTar =
        filename.endsWith('.tar') ||
        filename.endsWith('.tar.gz') ||
        filename.endsWith('.tgz');

      if (!isTar) {
        res.status(400).json({
          error: 'Unsupported file format. Please upload a .tar or .tar.gz archive.',
        });
        return;
      }

      const config = getConfig();
      const rawStream = Readable.from(req.file.buffer);
      const isGzipped = filename.endsWith('.tar.gz') || filename.endsWith('.tgz');

      const validatedStream = await validateTarStream(rawStream, {
        maxFileCount: config.uploads.max_file_count,
        maxSize: config.uploads.max_workspace_size,
        gzipped: isGzipped,
      });

      await injectFiles(session.container_id, validatedStream);

      res.status(200).json({ message: 'Files uploaded' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Uploads] Upload error:', message);

      if (
        message.includes('exceeds maximum') ||
        message.includes('Invalid path') ||
        message.includes('Symlink')
      ) {
        res.status(400).json({ error: message });
        return;
      }

      res.status(500).json({ error: 'Failed to upload files' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/upload-media — upload individual files into a session's container
// ---------------------------------------------------------------------------

function getMultiUpload() {
  const config = getConfig();
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.uploads.max_file_size,
      files: 50,
    },
  });
}

uploadRouter.post(
  '/:id/upload-media',
  requireAuth,
  (req, res, next) => getMultiUpload().array('files', 50)(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const session = await getSession(req.params.id as string, userId);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (session.status !== 'active' && session.status !== 'creating') {
        res.status(400).json({ error: `Cannot upload to session with status "${session.status}"` });
        return;
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files provided. Upload files using the "files" field.' });
        return;
      }

      const config = getConfig();
      let totalSize = 0;
      for (const file of files) {
        totalSize += file.size;
        if (totalSize > config.uploads.max_workspace_size) {
          res.status(400).json({ error: `Total upload size exceeds maximum of ${config.uploads.max_workspace_size} bytes` });
          return;
        }
      }

      // Validate filenames — reject path traversal
      for (const file of files) {
        const name = file.originalname;
        if (name.includes('..') || name.startsWith('/')) {
          res.status(400).json({ error: `Invalid filename: "${name}"` });
          return;
        }
      }

      // Pack individual files into a tar stream for injection
      const pack = tar.pack();
      for (const file of files) {
        pack.entry({ name: file.originalname, size: file.size }, file.buffer);
      }
      pack.finalize();

      await injectFiles(session.container_id, pack);

      res.status(200).json({
        message: `${files.length} file(s) uploaded`,
        files: files.map((f) => f.originalname),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Uploads] Media upload error:', message);
      res.status(500).json({ error: 'Failed to upload files' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:id/download — download the workspace as a gzipped tar archive
// ---------------------------------------------------------------------------

uploadRouter.get(
  '/:id/download',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const session = await getSession(req.params.id as string, userId);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (session.status !== 'active' && session.status !== 'grace') {
        res.status(400).json({
          error: `Cannot download from session with status "${session.status}"`,
        });
        return;
      }

      const date = new Date().toISOString().replace(/[:.]/g, '-');

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=workspace-${date}.tar.gz`,
      );

      const tarStream = await extractWorkspace(session.container_id);
      const gzip = createGzip();

      tarStream.pipe(gzip).pipe(res);

      tarStream.on('error', (err) => {
        console.error('[Uploads] Extract stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to extract workspace' });
        }
        gzip.destroy();
      });

      gzip.on('error', (err) => {
        console.error('[Uploads] Gzip stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to compress workspace' });
        }
      });
    } catch (err) {
      console.error('[Uploads] Download error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download workspace' });
      }
    }
  },
);

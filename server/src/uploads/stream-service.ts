import Docker from 'dockerode';
import { PassThrough } from 'stream';
import { createGunzip } from 'zlib';
import tar from 'tar-stream';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ---------------------------------------------------------------------------
// injectFiles — pipe a tar stream directly into a container's workspace
// ---------------------------------------------------------------------------

export async function injectFiles(
  containerId: string,
  tarStream: NodeJS.ReadableStream,
): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.putArchive(tarStream, { path: '/home/agent/workspace' });
}

// ---------------------------------------------------------------------------
// extractWorkspace — stream a tar archive out of a container's workspace
// ---------------------------------------------------------------------------

export async function extractWorkspace(
  containerId: string,
): Promise<NodeJS.ReadableStream> {
  const container = docker.getContainer(containerId);
  const stream = await container.getArchive({ path: '/home/agent/workspace' });
  return stream;
}

// ---------------------------------------------------------------------------
// validateTarStream — parse, validate, and re-pack a tar stream
// ---------------------------------------------------------------------------

export async function validateTarStream(
  tarStream: NodeJS.ReadableStream,
  opts: { maxFileCount: number; maxSize: number; gzipped?: boolean },
): Promise<NodeJS.ReadableStream> {
  const extract = tar.extract();
  const pack = tar.pack();

  let fileCount = 0;
  let totalSize = 0;

  extract.on('entry', (header, stream, next) => {
    fileCount++;

    // Reject if too many files
    if (fileCount > opts.maxFileCount) {
      stream.resume();
      extract.destroy(new Error(`Archive exceeds maximum file count of ${opts.maxFileCount}`));
      return;
    }

    // Reject path traversal: names containing '..' or starting with '/'
    if (header.name.includes('..') || header.name.startsWith('/')) {
      stream.resume();
      extract.destroy(new Error(`Invalid path in archive: "${header.name}"`));
      return;
    }

    // Reject symlinks pointing outside the workspace
    if (header.type === 'symlink' && header.linkname) {
      if (
        header.linkname.includes('..') ||
        (header.linkname.startsWith('/') &&
          !header.linkname.startsWith('/home/agent/workspace'))
      ) {
        stream.resume();
        extract.destroy(
          new Error(`Symlink "${header.name}" points outside workspace: "${header.linkname}"`),
        );
        return;
      }
    }

    // Track total size
    totalSize += header.size ?? 0;
    if (totalSize > opts.maxSize) {
      stream.resume();
      extract.destroy(
        new Error(`Archive exceeds maximum total size of ${opts.maxSize} bytes`),
      );
      return;
    }

    // Re-pack the entry into the output tar stream
    const entry = pack.entry(header, next);
    stream.pipe(entry);
  });

  extract.on('finish', () => {
    pack.finalize();
  });

  extract.on('error', (err) => {
    pack.destroy(err);
  });

  // Decompress gzipped archives before extracting
  if (opts.gzipped) {
    const gunzip = createGunzip();
    gunzip.on('error', (err) => {
      extract.destroy(err);
    });
    tarStream.pipe(gunzip).pipe(extract);
  } else {
    tarStream.pipe(extract);
  }

  return pack;
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

export function sanitizeBundleFolderName(rawName: string): string {
  const cleaned = rawName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'studio-scaffold-export';
}

/**
 * Safely writes an array of generated bundle files into `baseDir` with strict path-traversal protection.
 */
export function writeBundleFilesToDir(
  baseDir: string,
  files: Array<{ relativePath: string; code: string }>,
): { exportedDir: string; fileCount: number } {
  const resolvedRoot = resolve(baseDir);
  mkdirSync(resolvedRoot, { recursive: true });

  let fileCount = 0;
  for (const file of files) {
    if (!file || typeof file.relativePath !== 'string') continue;
    if (file.relativePath.includes('\0')) {
      throw new Error(`Invalid null byte in relativePath: "${file.relativePath}"`);
    }

    const trimmedRel = file.relativePath.trim().replace(/^[/\\]+/, '');
    if (!trimmedRel) continue;

    // Reject explicit parent-directory segments before resolving
    const rawSegments = trimmedRel.split(/[/\\]+/);
    if (rawSegments.some((seg) => seg === '..')) {
      throw new Error(`Security error: path traversal blocked for "${file.relativePath}"`);
    }

    const fullPath = resolve(resolvedRoot, trimmedRel);
    const relFromRoot = relative(resolvedRoot, fullPath);
    if (!relFromRoot || relFromRoot.startsWith('..') || isAbsolute(relFromRoot)) {
      throw new Error(`Security error: path traversal blocked for "${file.relativePath}"`);
    }

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, typeof file.code === 'string' ? file.code : String(file.code ?? ''), 'utf8');
    fileCount++;
  }

  return { exportedDir: resolvedRoot, fileCount };
}

export function resolveInteractiveExportDir(selectedParentDir: string, defaultFolderName: string): string {
  const safeFolder = sanitizeBundleFolderName(defaultFolderName);
  const resolvedParent = resolve(selectedParentDir);
  if (basename(resolvedParent).toLowerCase() === safeFolder.toLowerCase()) {
    return resolvedParent;
  }
  return join(resolvedParent, safeFolder);
}

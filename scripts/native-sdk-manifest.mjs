import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Paths, entry types and file hashes are pinned from the verified release ZIP.
// Reject symlinks/special files rather than hashing data outside the SDK tree.
export function frameworkContentHash(root) {
  const entries = [];
  function walk(relative) {
    for (const name of readdirSync(join(root, relative)).sort()) {
      if (!relative && name === '.lightning-piggy-version') continue;
      const path = relative ? `${relative}/${name}` : name;
      const file = join(root, path);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`SDK contains symlink: ${path}`);
      if (stat.isDirectory()) {
        entries.push([path, 'directory']);
        walk(path);
      } else if (stat.isFile()) {
        entries.push([path, 'file', createHash('sha256').update(readFileSync(file)).digest('hex')]);
      } else {
        throw new Error(`SDK contains unsupported entry: ${path}`);
      }
    }
  }
  walk('');
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

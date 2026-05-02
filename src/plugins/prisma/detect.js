// Activates when a Prisma schema file is present.
import fs from 'node:fs/promises';
import path from 'node:path';

const CANDIDATES = [
  'prisma/schema.prisma',
  'schema.prisma',
  'apps/api/prisma/schema.prisma',
  'packages/db/prisma/schema.prisma',
];

export default async function detect({ projectRoot }) {
  for (const rel of CANDIDATES) {
    try {
      await fs.access(path.join(projectRoot, rel));
      return true;
    } catch {}
  }
  return false;
}

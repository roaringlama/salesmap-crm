import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(`${root}cloud-server/src`, { recursive: true });
await cp(`${root}src`, `${root}cloud-server/src`, { recursive: true, filter: (path) => !path.endsWith('.test.ts') && !path.replaceAll('\\', '/').endsWith('/main.tsx') });
await cp(`${root}src/data/validate.ts`, `${root}cloud-server/lib/validate.ts`);
await cp(`${root}src/types.ts`, `${root}cloud-server/types.ts`);
console.log('Cloud client and validation synced.');

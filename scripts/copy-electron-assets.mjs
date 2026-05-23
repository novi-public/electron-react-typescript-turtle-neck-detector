import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

await fs.mkdir(path.join(rootDir, 'dist-electron'), { recursive: true });
await fs.copyFile(path.join(rootDir, 'electron/preload.cjs'), path.join(rootDir, 'dist-electron/preload.cjs'));

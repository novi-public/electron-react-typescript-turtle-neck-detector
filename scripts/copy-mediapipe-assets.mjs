import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'node_modules/@mediapipe/tasks-vision/wasm');
const targetDir = path.join(rootDir, 'public/mediapipe/wasm');

await fs.mkdir(targetDir, { recursive: true });

for (const fileName of await fs.readdir(sourceDir)) {
  await fs.copyFile(path.join(sourceDir, fileName), path.join(targetDir, fileName));
}

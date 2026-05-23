import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const alertImagesDir = path.join(rootDir, 'public/assets/alert-images');
const manifestPath = path.join(alertImagesDir, 'manifest.json');
const supportedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

await fs.mkdir(alertImagesDir, { recursive: true });

const fileNames = await fs.readdir(alertImagesDir);
const images = fileNames
  .filter((fileName) => supportedExtensions.has(path.extname(fileName).toLowerCase()))
  .sort((a, b) => a.localeCompare(b))
  .map((fileName) => ({
    id: fileName,
    name: fileName,
    path: `assets/alert-images/${encodeURIComponent(fileName)}`,
  }));

await fs.writeFile(manifestPath, `${JSON.stringify(images, null, 2)}\n`);

console.log(`Generated alert image manifest with ${images.length} image(s).`);

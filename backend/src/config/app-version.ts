import fs from 'fs';
import path from 'path';

const versionPaths = [
  path.resolve(process.cwd(), '..', 'VERSION'),
  path.resolve(process.cwd(), 'VERSION'),
  path.resolve(__dirname, '..', '..', '..', 'VERSION')
];

const versionPath = versionPaths.find(candidate => fs.existsSync(candidate));

if (!versionPath) {
  throw new Error('VERSION file not found. The application must be started from a complete ComfyForge installation.');
}

export const APP_VERSION = fs.readFileSync(versionPath, 'utf8').trim();

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(APP_VERSION)) {
  throw new Error(`Invalid application version in ${versionPath}`);
}

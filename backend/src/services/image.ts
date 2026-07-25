import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Project root is the parent of the backend directory if running from backend, 
// or the current directory if running from the root.
const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
const rootDir = path.resolve(backendDir, '..');

export const imagesDir = process.env.IMAGES_DIR
  ? path.resolve(process.env.IMAGES_DIR)
  : path.join(rootDir, 'images');
export const thumbnailsDir = path.join(imagesDir, 'thumbnails');

console.log(`[ImageService] Images directory: ${imagesDir}`);
console.log(`[ImageService] Thumbnails directory: ${thumbnailsDir}`);

if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir, { recursive: true });

export const generateThumbnail = async (originalPath: string, thumbPath: string) => {
  const dir = path.dirname(thumbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  return sharp(originalPath)
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toFile(thumbPath);
};

export const deleteFiles = (files: { imageUrl?: string; thumbnailUrl?: string }[]) => {
  const resolvedImagesDir = path.resolve(imagesDir);

  files.forEach(file => {
    try {
      if (file.imageUrl && file.imageUrl.startsWith('/api/image-files/')) {
        const relativePath = decodeURIComponent(file.imageUrl.replace('/api/image-files/', '').split('?')[0]);
        const imgPath = path.resolve(imagesDir, relativePath);
        if (!imgPath.startsWith(resolvedImagesDir + path.sep)) return;
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      }
      if (file.thumbnailUrl && file.thumbnailUrl.startsWith('/api/image-files/')) {
        const relativePath = decodeURIComponent(file.thumbnailUrl.replace('/api/image-files/', '').split('?')[0]);
        const thumbPath = path.resolve(imagesDir, relativePath);
        if (!thumbPath.startsWith(resolvedImagesDir + path.sep)) return;
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      }
    } catch (err) {
      console.error(`Failed to delete files:`, err);
    }
  });
};

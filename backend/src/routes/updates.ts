import express from 'express';
import axios from 'axios';
import { APP_VERSION } from '../config/app-version';

const router = express.Router();

const cleanVersion = (version: string) => version.replace(/^v/, '').replace(/^\./, '').trim();

export const compareVersions = (left: string, right: string) => {
  const leftParts = cleanVersion(left).split(/[.-]/).slice(0, 3).map(Number);
  const rightParts = cleanVersion(right).split(/[.-]/).slice(0, 3).map(Number);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
};

// Get current local version and check for updates on GitHub
router.get('/check', async (req, res) => {
  try {
    const repoUrl = 'https://api.github.com/repos/leguigou/ComfyForge/releases/latest';
    const response = await axios.get(repoUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ComfyForge-Update-Checker'
      },
      timeout: 5000
    });

    const latestRelease = response.data;
    const currentVersion = cleanVersion(APP_VERSION);
    const latestVersion = cleanVersion(latestRelease.tag_name);
    const comparison = compareVersions(latestVersion, currentVersion);
    const updateAvailable = comparison > 0;
    const localVersionAhead = comparison < 0;
    
    res.json({
      currentVersion,
      latestVersion,
      updateAvailable,
      localVersionAhead,
      releaseUrl: latestRelease.html_url,
      releaseNotes: latestRelease.body,
      publishedAt: latestRelease.published_at
    });
  } catch (error: any) {
    console.error('[UpdateCheck] Error:', error.message);
    // If GitHub fails, still return the local version
    res.json({
      currentVersion: APP_VERSION,
      error: 'Impossible de vérifier les mises à jour sur GitHub'
    });
  }
});

export default router;

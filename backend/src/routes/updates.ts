import express from 'express';
import axios from 'axios';
import { APP_VERSION } from '../config/app-version';

const router = express.Router();

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
    // Clean version strings: remove 'v', leading dots, and whitespace
    const clean = (v: string) => v.replace(/^v/, '').replace(/^\./, '').trim();
    
    const currentVersion = clean(APP_VERSION);
    const latestVersion = clean(latestRelease.tag_name);
    
    // Simple semver comparison: returns true if latest > current
    const isNewer = (latest: string, current: string) => {
      const l = latest.split('.').map(Number);
      const c = current.split('.').map(Number);
      for (let i = 0; i < Math.max(l.length, c.length); i++) {
        const lNum = l[i] || 0;
        const cNum = c[i] || 0;
        if (lNum > cNum) return true;
        if (lNum < cNum) return false;
      }
      return false;
    };

    const updateAvailable = isNewer(latestVersion, currentVersion);
    
    res.json({
      currentVersion,
      latestVersion,
      updateAvailable,
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

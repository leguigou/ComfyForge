# Contribuer à ComfyForge

Merci de votre intérêt pour le projet.

## Avant de commencer

1. Vérifiez qu’une issue similaire n’existe pas déjà.
2. Pour une évolution importante, ouvrez une issue afin de discuter de
   l’approche avant d’écrire beaucoup de code.
3. Ne joignez jamais de clé API, de fichier `.env`, de base SQLite ou d’image
   privée à une issue ou à une pull request.

## Installation de développement

Prérequis : Node.js 22, npm et une instance ComfyUI.

```bash
git clone https://github.com/leguigou/ComfyForge.git
cd ComfyForge
cp backend/.env.example backend/.env
cd backend && npm ci
cd ../frontend && npm ci
```

Renseignez au minimum `APP_PASSWORD`, `AUTH_SECRET` et `COMFY_URL` dans
`backend/.env`, puis lancez le backend et le frontend dans deux terminaux :

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm run dev
```

## Vérifications obligatoires

```bash
cd backend
npm audit --audit-level=high
npm test
npm run build

cd ../frontend
npm audit --audit-level=high
npm run lint
npm test
npm run build
```

## Pull requests

- Limitez chaque pull request à un objectif cohérent.
- Ajoutez ou adaptez les tests lorsque le comportement change.
- Décrivez les impacts visibles et les étapes de vérification.
- Ajoutez des captures avant/après pour les changements d’interface.
- Conservez la compatibilité avec les données persistantes existantes.

En contribuant, vous acceptez que votre contribution soit distribuée sous la
licence MIT du projet.

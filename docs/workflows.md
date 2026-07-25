# Workflows ComfyUI

ComfyForge envoie des workflows au format API à une instance ComfyUI. Les
modèles, VAE, LoRA et nœuds personnalisés restent installés et exécutés par
ComfyUI : ils ne sont pas inclus dans ce dépôt ni dans les images Docker.

## Option recommandée : importer votre workflow

1. Ouvrez un workflow fonctionnel dans ComfyUI.
2. Activez les options de développement de ComfyUI si nécessaire.
3. Utilisez **Save (API Format)**.
4. Dans ComfyForge, ouvrez **Paramètres → Workflows**.
5. Importez le fichier JSON.
6. Vérifiez l’association des nœuds proposée par ComfyForge, puis enregistrez.

Un workflow fonctionnant déjà dans votre installation ComfyUI est généralement
le moyen le plus simple de commencer.

## Exemples fournis

Les trois workflows du dossier `backend/workflows` servent d’exemples. Ils
nécessitent les fichiers suivants dans ComfyUI :

| Workflow | Fichiers référencés |
| --- | --- |
| `MOP_SDXL.json` | `mopMixtureOfPerverts_v71DMD.safetensors`, `sam_vit_b_01ec64.pth`, `bbox/Eyeful_v2-Paired.pt` |
| `workflow_lcm.json` | `dirtyRealism_DMDSAT.safetensors`, `sdxl_vae.safetensors`, `1x-ITF-SkinDiffDetail-Lite-v1.pth` |
| `ZIT_Photo_HD.json` | `intorealism_zitV70.safetensors`, `huihui-qwen3-4b-abliterated-v2-q8_0.gguf`, `zImage_vae.safetensors` |

Certains exemples utilisent également des nœuds personnalisés, notamment
rgthree, FaceDetailer, Efficient KSampler et plusieurs utilitaires d’image ou
de calcul. Si ComfyUI signale des types de nœuds inconnus, ouvrez d’abord le
workflow dans ComfyUI et utilisez le gestionnaire de nœuds pour installer les
dépendances manquantes.

Les noms ci-dessus sont uniquement des références de fichiers. Vérifiez la
licence et les conditions d’utilisation de chaque modèle avant de le
télécharger ou de l’utiliser.

## Diagnostic

- **Modèle introuvable** : le nom présent dans le workflow doit correspondre
  exactement au fichier installé dans ComfyUI.
- **Nœud inconnu** : installez l’extension correspondante dans ComfyUI, puis
  redémarrez ComfyUI.
- **Workflow refusé à l’import** : exportez-le avec **Save (API Format)** et non
  avec l’enregistrement standard.
- **Image non récupérée** : vérifiez que le workflow termine par un nœud
  `SaveImage` et que ce nœud est correctement associé lors de l’import.

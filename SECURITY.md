# Politique de sécurité

## Versions prises en charge

Les correctifs de sécurité sont publiés sur la dernière version disponible de
ComfyForge. Il est recommandé d’utiliser les images Docker portant le tag
`latest` ou la release GitHub la plus récente.

## Signaler une vulnérabilité

N’ouvrez pas d’issue publique pour une vulnérabilité ou pour un rapport
contenant des identifiants, des clés API ou des données personnelles.

Utilisez **Security → Report a vulnerability** sur GitHub afin d’envoyer un
rapport privé. Précisez :

- la version concernée ;
- les conditions nécessaires pour reproduire le problème ;
- son impact potentiel ;
- une proposition de correction, si vous en avez une.

Une première réponse sera apportée dès que possible. La publication du rapport
et du correctif sera coordonnée afin de laisser aux utilisateurs le temps de
mettre leur installation à jour.

## Bonnes pratiques de déploiement

- Utilisez un `AUTH_SECRET` aléatoire d’au moins 32 caractères.
- Utilisez un mot de passe administrateur unique et fort.
- N’exposez pas directement le port de ComfyUI sur Internet.
- Placez ComfyForge derrière un reverse proxy HTTPS pour tout accès distant.
- N’activez `ALLOW_PRIVATE_SERVICE_URLS` ou `ALLOW_USER_LLM_URLS` que si vous
  comprenez leur impact.
- Sauvegardez `backend/data`, `backend/workflows` et `images`.

# Déploiement sur Vercel — Routine Boss

## 1. Variables d'environnement à configurer dans Vercel

Dans **Vercel Dashboard → Project → Settings → Environment Variables**, ajouter les trois variables suivantes (disponibles dans ton `.env.local`) :

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | ID client OAuth2 (se termine par `.apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | Secret client OAuth2 (commence par `GOCSPX-`) |
| `GOOGLE_REFRESH_TOKEN` | Refresh token longue durée extrait de `token.json` → clé `refresh_token` |

Les trois variables doivent être activées pour les environnements **Production**, **Preview** et **Development**.

---

## 2. URIs de redirection Google Cloud Console — Ce que tu dois (et ne dois pas) faire

### Bonne nouvelle : aucune URI Vercel à ajouter pour le déploiement actuel

L'architecture du projet utilise un **refresh token statique** stocké dans les variables d'environnement. Le flux OAuth complet (code → token) ne se produit **que localement** via `npm run calendar`, jamais sur Vercel.

Sur Vercel, les API routes utilisent directement `GOOGLE_REFRESH_TOKEN` pour s'authentifier — il n'y a aucun callback OAuth à recevoir côté serveur.

### Ce qui doit déjà être présent dans Google Cloud Console (pour le local)

Dans **Google Cloud Console → APIs & Services → Credentials → ton Client OAuth2** :

| URI autorisée | Pourquoi |
|---|---|
| `http://localhost:3001` | Callback du script `npm run calendar` (port hardcodé dans `scripts/calendar.ts`) |

Si cette URI est absente, la génération du token échouera.

### Cas où tu devrais ajouter une URI Vercel (futur)

Si tu décides un jour d'implémenter un flux OAuth multi-utilisateurs directement dans l'app web (ex. : chaque visiteur connecte son propre Google Calendar), tu devrais alors ajouter :

```
https://ton-projet.vercel.app/api/auth/callback
```

Ce n'est **pas le cas actuellement** — ne pas ajouter cette URI inutilement.

---

## 3. Étapes de déploiement

```bash
# 1. S'assurer que le build passe sans erreur
npm run build

# 2. S'assurer que token.json existe et contient un refresh_token valide
npm run calendar

# 3. Copier la valeur du refresh_token depuis token.json
cat token.json   # → copier la valeur de "refresh_token"
```

Ensuite dans Vercel :
1. Connecter le dépôt Git (GitHub / GitLab / Bitbucket)
2. Ajouter les 3 variables d'environnement (voir §1)
3. Déployer — Vercel détecte automatiquement Next.js

---

## 4. Vérification post-déploiement

Une fois déployé sur `https://ton-projet.vercel.app` :

- `GET /api/calendar` → doit retourner les événements GCal
- `POST /api/sync` → doit créer des événements dans GCal
- Si erreur 500 "Variables d'environnement manquantes" → vérifier que les 3 vars sont bien présentes dans Vercel

### Refresh token expiré ?

Les refresh tokens Google OAuth de type "Application de bureau" n'expirent pas tant que :
- L'application n'est pas en mode "Test" avec plus de 7 jours d'inactivité (si app non vérifiée)
- L'utilisateur ne révoque pas l'accès manuellement

En cas d'expiration, supprimer `token.json` localement et relancer `npm run calendar`.

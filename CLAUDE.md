# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commandes courantes

```bash
npm run dev        # Serveur de développement Next.js (http://localhost:3000)
npm run build      # Build de production
npm run start      # Démarrer le serveur de production
npm run calendar   # Exécuter le script Google Calendar (tsx scripts/calendar.ts)
```

## Architecture

Projet **Next.js** avec TypeScript utilisant le **Pages Router** (`pages/`). La configuration TypeScript exclut volontairement le dossier `scripts/` de la compilation Next.js.

### Script Google Calendar (`scripts/calendar.ts`)

Script autonome (exécuté via `tsx`, hors du contexte Next.js) qui consulte les 10 prochains événements du Google Calendar principal via l'API Google Calendar v3 avec OAuth2.

Flux d'authentification :
1. Lit `credentials.json` à la racine (identifiants OAuth2 de type "Application de bureau")
2. Si `token.json` est absent, lance un serveur HTTP local sur le port 3001, génère une URL d'autorisation et attend le callback OAuth
3. Sauvegarde le token dans `token.json` pour les exécutions suivantes

Les fichiers `credentials.json` et `token.json` sont dans `.gitignore` et ne doivent jamais être commités.

### Alias de chemin

`@/*` pointe vers la racine du projet (configuré dans `tsconfig.json`).

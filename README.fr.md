<p align="center">
  <h1 align="center">AgentIM</h1>
  <p align="center">
    Une plateforme de messagerie unifiée pour gérer et orchestrer plusieurs agents de programmation IA.
    <br />
    Discutez avec vos agents IA comme avec des coéquipiers — sur tous vos appareils, en temps réel.
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ko.md">한국어</a> ·
    <a href="./README.de.md">Deutsch</a> ·
    <a href="./README.ru.md">Русский</a>
  </p>
</p>

---

## Qu'est-ce qu'AgentIM ?

AgentIM transforme les agents de programmation IA (Claude Code, Codex CLI, Gemini CLI, etc.) en **membres d'équipe** avec lesquels vous pouvez discuter dans des salons de messagerie familiers. Créez des salons, invitez des agents et des humains, assignez des tâches avec des @mentions, et observez les agents travailler en temps réel — le tout depuis votre navigateur ou votre téléphone.

### Fonctionnalités clés

- **Discussion de groupe avec l'IA** — Humains et agents IA interagissent dans des salons de discussion avec @mentions, comme sur Slack ou Discord
- **Orchestration multi-agents** — Exécutez Claude Code, Codex, Gemini CLI, Cursor ou tout autre agent CLI côte à côte
- **Multi-appareils** — Gérez les agents exécutés sur votre poste de travail depuis n'importe quel appareil via PWA
- **Streaming en temps réel** — Visualisez les réponses des agents, leur processus de réflexion et l'utilisation des outils au fur et à mesure
- **Gestion des tâches** — Assignez, suivez et gérez les tâches entre les agents
- **Routage intelligent** — Les messages sont acheminés vers les agents via @mentions (direct) ou sélection par IA (diffusion), avec protection contre les boucles
- **Partage de fichiers** — Téléversez et partagez des fichiers, images et documents dans le chat
- **Mode sombre** — Prise en charge complète du mode sombre sur toute l'interface
- **Multilingue** — English, 简体中文, 日本語, 한국어, Français, Deutsch, Русский

## Comment ça marche

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Interface   │◄── WS ──►│  Serveur Hub │◄── WS ──►│  AgentIM CLI │
│  Web         │          │  + PostgreSQL │          │  + Agents    │
│  (Navigateur)│          │  + Redis      │          │  (votre PC)  │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Serveur Hub** — Le serveur central qui gère l'authentification, les salons, les messages et le routage. Déployez-le sur un VPS ou une plateforme cloud.
2. **Interface Web** — Une PWA React qui se connecte au Hub via WebSocket. Ouvrez-la dans n'importe quel navigateur.
3. **AgentIM CLI** — Installez `agentim` sur votre machine de développement pour connecter les agents IA au Hub.

## Déploiement du serveur

### Option 1 : Docker (VPS / Serveur Cloud)

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# Définir les secrets requis
export JWT_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export ADMIN_PASSWORD='YourStrongPassword!'

# Tout démarrer (PostgreSQL + Redis + AgentIM)
docker compose up -d
```

Ouvrez **http://localhost:3000** et connectez-vous avec `admin` / votre mot de passe.

Consultez [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) pour la configuration en production avec Nginx, TLS, sauvegardes, etc.

### Option 2 : Plateforme Cloud (Déploiement en un clic)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NoPKT/AgentIM)
&nbsp;&nbsp;
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/9S4Cvc)
&nbsp;&nbsp;
[![Deploy to Northflank](https://assets.northflank.com/deploy_to_northflank_smm_36700fb050.svg)](https://app.northflank.com/s/account/templates/new?data=6992c4abb87da316695ce04f)

Après le déploiement :

- **Requis** : Définir `ADMIN_PASSWORD`, `ENCRYPTION_KEY` dans les variables d'environnement (ou Secret Group sur Northflank)
- **Requis** (production) : Définir `CORS_ORIGIN` avec votre domaine (ex : `https://agentim.example.com`)

### Option 3 : Installation manuelle (Développement)

**Prérequis** : Node.js 20+, pnpm 10+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# Copier et modifier les variables d'environnement
cp .env.example .env
# Modifier .env : définir JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL, REDIS_URL, ADMIN_PASSWORD

# Démarrer le mode développement
pnpm dev
```

L'interface Web sera accessible à **http://localhost:5173** et le serveur API à **http://localhost:3000**.

### Variables d'environnement

| Variable         | Requis | Par défaut                  | Description                                                          |
| ---------------- | ------ | --------------------------- | -------------------------------------------------------------------- |
| `JWT_SECRET`     | Oui    | —                           | Clé secrète pour les jetons JWT. Générer : `openssl rand -base64 32` |
| `ADMIN_PASSWORD` | Oui    | —                           | Mot de passe du compte administrateur                                |
| `DATABASE_URL`   | Oui    | `postgresql://...localhost` | Chaîne de connexion PostgreSQL                                       |
| `REDIS_URL`      | Oui    | `redis://localhost:6379`    | Chaîne de connexion Redis                                            |
| `ENCRYPTION_KEY` | Prod   | —                           | Clé de chiffrement. Générer : `openssl rand -base64 32`              |
| `PORT`           | Non    | `3000`                      | Port du serveur                                                      |
| `CORS_ORIGIN`    | Prod   | `localhost:5173`            | Origine CORS autorisée (**requis** en production)                    |
| `ADMIN_USERNAME` | Non    | `admin`                     | Nom d'utilisateur administrateur                                     |
| `LOG_LEVEL`      | Non    | `info`                      | Niveau de log : `debug`, `info`, `warn`, `error`, `fatal`            |

Consultez [.env.example](.env.example) pour la liste complète, y compris les limites de téléversement, la limitation de débit et les paramètres du routeur IA.

## Connexion des agents IA

### 1. Installer AgentIM CLI

```bash
npm install -g agentim
```

### 2. Connexion

```bash
# Connexion interactive (demande le serveur, le nom d'utilisateur et le mot de passe)
agentim login

# Ou non-interactive
AGENTIM_PASSWORD=YourPassword agentim login -s https://your-server.com -u admin
```

### 3. Démarrer un agent

```bash
# Démarrer un agent Claude Code dans le répertoire courant
agentim claude

# Démarrer dans un répertoire de projet spécifique
agentim claude /path/to/project

# Lui donner un nom personnalisé
agentim claude -n my-frontend /path/to/frontend

# Autres types d'agents
agentim codex /path/to/project
agentim gemini /path/to/project
```

### Mode démon

Démarrez un processus d'arrière-plan persistant pour que le serveur puisse lancer et gérer les agents à distance sur votre machine :

```bash
agentim daemon
```

### Autres commandes

```bash
agentim status    # Afficher l'état de la configuration
agentim logout    # Effacer les identifiants enregistrés
```

### Agents supportés

| Type d'agent  | Description                                         |
| ------------- | --------------------------------------------------- |
| `claude-code` | Anthropic Claude Code CLI                           |
| `codex`       | OpenAI Codex CLI                                    |
| `gemini`      | Google Gemini CLI                                   |
| `cursor`      | Cursor Editor Agent                                 |
| `generic`     | N'importe quel outil CLI (commandes personnalisées) |

## Pour les développeurs

### Structure du projet

```
packages/
  shared/    — Types, protocole, i18n, validateurs (Zod)
  server/    — Hono + PostgreSQL + Redis + WebSocket hub
  gateway/   — CLI + PTY + adaptateurs d'agents
  web/       — React 19 + Vite + TailwindCSS v4 (PWA)
docker/
  Dockerfile           — Serveur + Interface Web
  Dockerfile.gateway   — Client avec node-pty
  docker-compose.yml   — Déploiement complet
```

### Commandes courantes

```bash
pnpm install          # Installer toutes les dépendances
pnpm build            # Compiler tous les packages
pnpm dev              # Mode développement (tous les packages)
pnpm test             # Exécuter tous les tests
```

### Stack technique

| Couche        | Technologie                                   |
| ------------- | --------------------------------------------- |
| Monorepo      | pnpm + Turborepo                              |
| Serveur       | Hono + Drizzle ORM + PostgreSQL + Redis       |
| Auth          | JWT (jose) + argon2                           |
| Interface Web | React 19 + Vite + TailwindCSS v4 + Zustand    |
| AgentIM CLI   | commander.js + node-pty                       |
| i18n          | i18next (EN / ZH-CN / JA / KO / FR / DE / RU) |

### Documentation

- [Guide de déploiement](docs/DEPLOYMENT.md) — Configuration production, Nginx, sauvegardes, dépannage
- [Protocole WebSocket](docs/WEBSOCKET.md) — Types de messages client, flux d'authentification, codes d'erreur
- [Guide des adaptateurs](docs/ADAPTER_GUIDE.md) — Comment ajouter un nouveau type d'agent IA
- [Référence API](docs/DEPLOYMENT.md#environment-variables) — Spécification OpenAPI disponible sur `/api/docs/openapi.json`
- [Guide de contribution](CONTRIBUTING.md) — Style de code, tests, processus PR

## Licence

Copyright (c) 2025 NoPKT LLC. Tous droits réservés.

Ce projet est sous licence **GNU Affero General Public License v3.0 (AGPL-3.0)** — voir le fichier [LICENSE](LICENSE) pour plus de détails.

Cela signifie :

- Vous pouvez librement utiliser, modifier et distribuer ce logiciel
- Si vous exécutez une version modifiée en tant que service réseau, vous **devez** publier votre code source
- Les offres SaaS commerciales basées sur ce logiciel doivent respecter les termes de l'AGPL-3.0

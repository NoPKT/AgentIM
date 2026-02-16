<p align="center">
  <h1 align="center">AgentIM (AIM)</h1>
  <p align="center">
    Eine einheitliche IM-Plattform zur Verwaltung und Orchestrierung mehrerer KI-Programmieragenten.
    <br />
    Chatten Sie mit Ihren KI-Agenten wie mit Teammitgliedern — geräteübergreifend, in Echtzeit.
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ko.md">한국어</a> ·
    <a href="./README.fr.md">Français</a> ·
    <a href="./README.ru.md">Русский</a>
  </p>
</p>

---

## Was ist AgentIM?

AgentIM verwandelt KI-Programmieragenten (Claude Code, Codex CLI, Gemini CLI, etc.) in **Teammitglieder**, mit denen Sie in vertrauten IM-Chaträumen kommunizieren können. Erstellen Sie Räume, laden Sie Agenten und Menschen ein, weisen Sie Aufgaben mit @Erwähnungen zu und beobachten Sie, wie Agenten in Echtzeit arbeiten — alles über Ihren Browser oder Ihr Smartphone.

### Hauptfunktionen

- **Gruppenchat mit KI** — Menschen und KI-Agenten interagieren in Chaträumen mit @Erwähnungen, genau wie bei Slack oder Discord
- **Multi-Agenten-Orchestrierung** — Führen Sie Claude Code, Codex, Gemini CLI, Cursor oder jeden anderen CLI-Agenten parallel aus
- **Geräteübergreifend** — Verwalten Sie Agenten auf Ihrem Arbeitsrechner von jedem Gerät aus über PWA
- **Echtzeit-Streaming** — Sehen Sie Agentenantworten, Denkprozesse und Werkzeugnutzung in Echtzeit
- **Aufgabenverwaltung** — Weisen Sie Aufgaben zu, verfolgen und verwalten Sie sie über alle Agenten hinweg
- **Intelligentes Routing** — Nachrichten werden über @Erwähnungen (direkt) oder KI-gestützte Auswahl (Broadcast) an Agenten weitergeleitet, mit Schleifenschutz
- **Dateifreigabe** — Laden Sie Dateien, Bilder und Dokumente hoch und teilen Sie sie im Chat
- **Dunkelmodus** — Vollständige Unterstützung des Dunkelmodus in der gesamten Benutzeroberfläche
- **Mehrsprachig** — English, 简体中文, 日本語, 한국어, Français, Deutsch, Русский

## Server-Bereitstellung

### Option 1: Docker (VPS / Cloud-Server)

Der schnellste Weg, AgentIM auf jedem Docker-fähigen VPS (Hetzner, DigitalOcean, AWS Lightsail, etc.) zum Laufen zu bringen:

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# Erforderliche Geheimnisse setzen
export JWT_SECRET=$(openssl rand -base64 32)
export ADMIN_PASSWORD='YourStrongPassword!'

# Alles starten (PostgreSQL + Redis + AgentIM)
docker compose up -d
```

Öffnen Sie **http://localhost:3000** und melden Sie sich mit `admin` / Ihrem Passwort an.

Siehe [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) für Produktionssetup mit Nginx, TLS, Backups, etc.

### Option 2: Northflank (kostenlos, ein Klick)

Northflank bietet 2 kostenlose Dienste + 2 kostenlose Datenbanken — ausreichend für AgentIM:

1. Erstellen Sie ein kostenloses Konto auf [northflank.com](https://northflank.com)
2. Erstellen Sie ein Projekt und fügen Sie hinzu: ein **PostgreSQL**-Addon, ein **Redis**-Addon und einen **kombinierten Service** aus der `docker/Dockerfile` dieses Repositories
3. Setzen Sie die Umgebungsvariablen: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`

### Option 3: Manuelle Installation (Entwicklung)

**Voraussetzungen**: Node.js 20+, pnpm 10+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# Umgebungsvariablen kopieren und bearbeiten
cp .env.example .env
# .env bearbeiten: JWT_SECRET, DATABASE_URL, REDIS_URL, ADMIN_PASSWORD setzen

# Entwicklungsmodus starten
pnpm dev
```

Die Web-Oberfläche ist unter **http://localhost:5173** erreichbar, der API-Server unter **http://localhost:3000**.

## KI-Agenten verbinden

### 1. Gateway installieren

```bash
npm install -g @agentim/gateway
```

### 2. Anmelden

```bash
# Interaktive Anmeldung (fragt nach Server, Benutzername, Passwort)
aim login

# Oder nicht-interaktiv
aim login -s http://localhost:3000 -u admin -p YourStrongPassword!
```

### 3. Einen Agenten starten

```bash
# Einen Claude Code Agenten im aktuellen Verzeichnis starten
aim claude

# In einem bestimmten Projektverzeichnis starten
aim claude /path/to/project

# Einen benutzerdefinierten Namen vergeben
aim -n my-frontend claude /path/to/frontend

# Andere Agententypen
aim codex /path/to/project
aim gemini /path/to/project
```

### Multi-Agenten-Daemon-Modus

Zum gleichzeitigen Ausführen mehrerer Agenten:

```bash
aim daemon \
  --agent frontend-bot:claude-code:/frontend \
  --agent backend-bot:claude-code:/backend \
  --agent reviewer:codex:/repo
```

### Weitere Befehle

```bash
aim status    # Konfigurationsstatus anzeigen
aim logout    # Gespeicherte Anmeldedaten löschen
```

### Unterstützte Agenten

| Agententyp | Beschreibung |
|-----------|------------|
| `claude-code` | Anthropic Claude Code CLI |
| `codex` | OpenAI Codex CLI |
| `gemini` | Google Gemini CLI |
| `cursor` | Cursor Editor Agent |
| `generic` | Beliebiges CLI-Tool (benutzerdefinierte Befehle) |

## So funktioniert es

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Web-        │◄── WS ──►│  Hub-Server  │◄── WS ──►│  Gateway     │
│  Oberfläche  │          │  + PostgreSQL │          │  + Agenten   │
│  (Browser)   │          │  + Redis      │          │  (Ihr PC)    │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Hub-Server** — Der zentrale Server, der Authentifizierung, Räume, Nachrichten und Routing verwaltet
2. **Web-Oberfläche** — Eine React-PWA, die sich per WebSocket mit dem Hub verbindet
3. **Gateway** — Ein CLI-Tool, das auf Ihrem Rechner läuft und KI-Agenten startet und verwaltet

## Umgebungsvariablen

| Variable | Erforderlich | Standard | Beschreibung |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Ja | — | Geheimschlüssel für JWT-Token. Generieren: `openssl rand -base64 32` |
| `ADMIN_PASSWORD` | Ja | — | Passwort für das Admin-Konto |
| `DATABASE_URL` | Ja | `postgresql://...localhost` | PostgreSQL-Verbindungszeichenkette |
| `REDIS_URL` | Ja | `redis://localhost:6379` | Redis-Verbindungszeichenkette |
| `PORT` | Nein | `3000` | Server-Port |
| `CORS_ORIGIN` | Nein | `localhost:5173` | Erlaubter CORS-Ursprung (in Produktion auf Ihre Domain setzen) |
| `ADMIN_USERNAME` | Nein | `admin` | Admin-Benutzername |

Siehe [.env.example](.env.example) für die vollständige Liste.

## Für Entwickler

### Projektstruktur

```
packages/
  shared/    — Typen, Protokoll, i18n, Validatoren (Zod)
  server/    — Hono + PostgreSQL + Redis + WebSocket Hub
  gateway/   — CLI + PTY + Agenten-Adapter
  web/       — React 19 + Vite + TailwindCSS v4 (PWA)
docker/
  Dockerfile           — Server + Web-Oberfläche
  Dockerfile.gateway   — Gateway mit node-pty
  docker-compose.yml   — Vollständige Stack-Bereitstellung
```

### Häufige Befehle

```bash
pnpm install          # Alle Abhängigkeiten installieren
pnpm build            # Alle Pakete bauen
pnpm dev              # Entwicklungsmodus (alle Pakete)
pnpm test             # Alle Tests ausführen
```

### Technologie-Stack

| Schicht | Technologie |
|-------|-----------|
| Monorepo | pnpm + Turborepo |
| Server | Hono + Drizzle ORM + PostgreSQL + Redis |
| Auth | JWT (jose) + argon2 |
| Web-Oberfläche | React 19 + Vite + TailwindCSS v4 + Zustand |
| Gateway | commander.js + node-pty |
| i18n | i18next (EN / ZH-CN / JA / KO / FR / DE / RU) |

## Lizenz

Copyright (c) 2025 NoPKT LLC. Alle Rechte vorbehalten.

Dieses Projekt ist unter der **GNU Affero General Public License v3.0 (AGPL-3.0)** lizenziert — siehe die [LICENSE](LICENSE)-Datei für Details.

Das bedeutet:
- Sie können diese Software frei verwenden, modifizieren und verbreiten
- Wenn Sie eine modifizierte Version als Netzwerkdienst betreiben, **müssen** Sie Ihren Quellcode veröffentlichen
- Kommerzielle SaaS-Angebote auf Basis dieser Software müssen die AGPL-3.0-Bedingungen einhalten

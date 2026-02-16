<p align="center">
  <h1 align="center">AgentIM</h1>
  <p align="center">
    Единая IM-платформа для управления и оркестрации нескольких ИИ-агентов программирования.
    <br />
    Общайтесь с вашими ИИ-агентами как с коллегами — с любого устройства, в реальном времени.
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ko.md">한국어</a> ·
    <a href="./README.fr.md">Français</a> ·
    <a href="./README.de.md">Deutsch</a>
  </p>
</p>

---

## Что такое AgentIM?

AgentIM превращает ИИ-агентов программирования (Claude Code, Codex CLI, Gemini CLI и др.) в **членов команды**, с которыми можно общаться в привычных чат-комнатах. Создавайте комнаты, приглашайте агентов и людей, назначайте задачи через @упоминания и наблюдайте за работой агентов в реальном времени — прямо из браузера или с телефона.

### Основные возможности

- **Групповой чат с ИИ** — Люди и ИИ-агенты взаимодействуют в чат-комнатах с @упоминаниями, как в Slack или Discord
- **Оркестрация нескольких агентов** — Запускайте Claude Code, Codex, Gemini CLI, Cursor или любой CLI-агент параллельно
- **Кроссплатформенность** — Управляйте агентами на рабочей станции с любого устройства через PWA
- **Потоковая передача в реальном времени** — Наблюдайте за ответами агентов, процессом мышления и использованием инструментов по мере их появления
- **Управление задачами** — Назначайте, отслеживайте и управляйте задачами между агентами
- **Умная маршрутизация** — Сообщения направляются агентам через @упоминания (напрямую) или ИИ-выбор (рассылка), с защитой от зацикливания
- **Обмен файлами** — Загружайте и делитесь файлами, изображениями и документами в чате
- **Тёмная тема** — Полная поддержка тёмной темы во всём интерфейсе
- **Многоязычность** — English, 简体中文, 日本語, 한국어, Français, Deutsch, Русский

## Развёртывание сервера

### Вариант 1: Развёртывание в один клик

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NoPKT/AgentIM)
&nbsp;&nbsp;
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/9S4Cvc)

После развёртывания установите `ADMIN_PASSWORD` в переменных окружения.

### Вариант 2: Docker (VPS / Облачный сервер)

Самый быстрый способ запустить AgentIM на любом VPS с поддержкой Docker (Hetzner, DigitalOcean, AWS Lightsail и др.):

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# Установить необходимые секреты
export JWT_SECRET=$(openssl rand -base64 32)
export ADMIN_PASSWORD='YourStrongPassword!'

# Запустить всё (PostgreSQL + Redis + AgentIM)
docker compose up -d
```

Откройте **http://localhost:3000** и войдите с логином `admin` / вашим паролем.

Подробнее о настройке для продакшена с Nginx, TLS, резервным копированием и т.д. см. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Вариант 3: Northflank (бесплатный план, постоянно работает, без холодного старта)

Northflank предлагает 2 бесплатных сервиса + 2 бесплатные базы данных — этого достаточно для AgentIM:

[![Развернуть на Northflank](https://northflank.com/button.svg)](https://app.northflank.com/s/account/templates/new?data=6992c4abb87da316695ce04f)

После развёртывания измените `ADMIN_PASSWORD` в Secret Group.

### Вариант 4: Ручная установка (Разработка)

**Требования**: Node.js 20+, pnpm 10+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# Скопировать и отредактировать переменные окружения
cp .env.example .env
# Отредактировать .env: установить JWT_SECRET, DATABASE_URL, REDIS_URL, ADMIN_PASSWORD

# Запустить режим разработки
pnpm dev
```

Веб-интерфейс будет доступен по адресу **http://localhost:5173**, а API-сервер — по адресу **http://localhost:3000**.

## Подключение AI-агентов

### 1. Установка AgentIM CLI

```bash
npm install -g agentim
```

Эта команда устанавливает инструмент командной строки `agentim`, который подключает ИИ-агентов на вашем компьютере к серверу AgentIM.

### 2. Вход в систему

```bash
# Интерактивный вход (запрашивает сервер, имя пользователя, пароль)
agentim login

# Или неинтерактивный
agentim login -s http://localhost:3000 -u admin -p YourStrongPassword!
```

### 3. Запуск агента

```bash
# Запустить агента Claude Code в текущей директории
agentim claude

# Запустить в определённой директории проекта
agentim claude /path/to/project

# Задать пользовательское имя
agentim -n my-frontend claude /path/to/frontend

# Другие типы агентов
agentim codex /path/to/project
agentim gemini /path/to/project
```

### Режим демона

Запустите постоянный фоновый процесс, чтобы сервер мог удалённо запускать и управлять агентами на вашем компьютере:

```bash
agentim daemon
```

Также можно предварительно зарегистрировать агентов при запуске:

```bash
agentim daemon --agent my-bot:claude-code:/path/to/project
```

### Другие команды

```bash
agentim status    # Показать состояние конфигурации
agentim logout    # Удалить сохранённые учётные данные
```

### Поддерживаемые агенты

| Тип агента    | Описание                                        |
| ------------- | ----------------------------------------------- |
| `claude-code` | Anthropic Claude Code CLI                       |
| `codex`       | OpenAI Codex CLI                                |
| `gemini`      | Google Gemini CLI                               |
| `cursor`      | Cursor Editor Agent                             |
| `generic`     | Любой CLI-инструмент (пользовательские команды) |

## Как это работает

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Веб-        │◄── WS ──►│  Hub-сервер  │◄── WS ──►│  AgentIM CLI │
│  интерфейс   │          │  + PostgreSQL │          │  + Агенты    │
│  (Браузер)   │          │  + Redis      │          │  (ваш ПК)   │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Hub-сервер** — Центральный сервер, отвечающий за аутентификацию, комнаты, сообщения и маршрутизацию
2. **Веб-интерфейс** — React PWA, подключающийся к Hub через WebSocket
3. **AgentIM CLI** — Инструмент командной строки (`agentim`), который запускается на вашем компьютере и управляет ИИ-агентами

## Переменные окружения

| Переменная       | Обязательна | По умолчанию                | Описание                                                                 |
| ---------------- | ----------- | --------------------------- | ------------------------------------------------------------------------ |
| `JWT_SECRET`     | Да          | —                           | Секретный ключ для JWT-токенов. Сгенерировать: `openssl rand -base64 32` |
| `ADMIN_PASSWORD` | Да          | —                           | Пароль для учётной записи администратора                                 |
| `DATABASE_URL`   | Да          | `postgresql://...localhost` | Строка подключения к PostgreSQL                                          |
| `REDIS_URL`      | Да          | `redis://localhost:6379`    | Строка подключения к Redis                                               |
| `PORT`           | Нет         | `3000`                      | Порт сервера                                                             |
| `CORS_ORIGIN`    | Нет         | `localhost:5173`            | Разрешённый CORS-источник (укажите ваш домен в продакшене)               |
| `ADMIN_USERNAME` | Нет         | `admin`                     | Имя пользователя администратора                                          |

Полный список см. в [.env.example](.env.example).

## Для разработчиков

### Структура проекта

```
packages/
  shared/    — Типы, протокол, i18n, валидаторы (Zod)
  server/    — Hono + PostgreSQL + Redis + WebSocket hub
  gateway/   — CLI + PTY + адаптеры агентов
  web/       — React 19 + Vite + TailwindCSS v4 (PWA)
docker/
  Dockerfile           — Сервер + Веб-интерфейс
  Dockerfile.gateway   — Gateway с node-pty
  docker-compose.yml   — Развёртывание полного стека
```

### Основные команды

```bash
pnpm install          # Установить все зависимости
pnpm build            # Собрать все пакеты
pnpm dev              # Режим разработки (все пакеты)
pnpm test             # Запустить все тесты
```

### Технологический стек

| Уровень         | Технология                                    |
| --------------- | --------------------------------------------- |
| Монорепозиторий | pnpm + Turborepo                              |
| Сервер          | Hono + Drizzle ORM + PostgreSQL + Redis       |
| Аутентификация  | JWT (jose) + argon2                           |
| Веб-интерфейс   | React 19 + Vite + TailwindCSS v4 + Zustand    |
| AgentIM CLI     | commander.js + node-pty                       |
| i18n            | i18next (EN / ZH-CN / JA / KO / FR / DE / RU) |

## Лицензия

Copyright (c) 2025 NoPKT LLC. Все права защищены.

Этот проект лицензирован под **GNU Affero General Public License v3.0 (AGPL-3.0)** — подробности см. в файле [LICENSE](LICENSE).

Это означает:

- Вы можете свободно использовать, модифицировать и распространять это программное обеспечение
- Если вы запускаете модифицированную версию как сетевой сервис, вы **обязаны** опубликовать свой исходный код
- Коммерческие SaaS-предложения на основе этого ПО должны соответствовать условиям AGPL-3.0

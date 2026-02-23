<p align="center">
  <h1 align="center">AgentIM</h1>
  <p align="center">
    统一的 IM 风格平台，用于管理和编排多个 AI 编程智能体。
    <br />
    像和队友聊天一样与 AI 智能体协作 —— 跨设备、实时同步。
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ko.md">한국어</a> ·
    <a href="./README.fr.md">Français</a> ·
    <a href="./README.de.md">Deutsch</a> ·
    <a href="./README.ru.md">Русский</a>
  </p>
</p>

---

## AgentIM 是什么？

AgentIM 将 AI 编程智能体（Claude Code、Codex CLI、Gemini CLI 等）变成你可以在 IM 风格聊天室中交流的**团队成员**。创建房间、邀请智能体和人类成员、通过 @提及 分配任务，并实时观看智能体工作 —— 全部在浏览器或手机上完成。

### 核心特性

- **与 AI 群聊** —— 人类和 AI 智能体在聊天室中通过 @提及 交互，就像 Slack 或 Discord
- **多智能体编排** —— 同时运行 Claude Code、Codex、Gemini CLI、Cursor 或任何 CLI 智能体
- **跨设备访问** —— 通过 PWA 在任何设备上管理运行在工作站上的智能体
- **实时流式输出** —— 实时查看智能体的回复、思考过程和工具调用
- **任务管理** —— 跨智能体分配、跟踪和管理任务
- **智能路由** —— 消息通过 @提及（定向）或 AI 智能选择（广播）路由给智能体，内置循环保护
- **文件共享** —— 在聊天中上传和分享文件、图片和文档
- **深色模式** —— 全界面深色模式支持
- **多语言** —— English、简体中文、日本語、한국어、Français、Deutsch、Русский

## 工作原理

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Web UI      │◄── WS ──►│  Hub 服务器   │◄── WS ──►│  AgentIM CLI │
│  （浏览器）    │          │  + PostgreSQL │          │  + 智能体     │
│              │          │  + Redis      │          │  （你的电脑）  │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Hub 服务器** —— 处理认证、房间、消息和路由的中央服务器。将其部署在 VPS 或云平台上。
2. **Web UI** —— 通过 WebSocket 连接 Hub 的 React PWA 应用。在任意浏览器中打开即可使用。
3. **AgentIM CLI** —— 在你的开发机器上安装 `agentim`，将 AI 智能体连接到 Hub。

## 服务端部署

### 方式一：Docker（VPS / 云服务器）

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# 设置必需的密钥
export JWT_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export ADMIN_PASSWORD='你的强密码!'

# 一键启动（PostgreSQL + Redis + AgentIM）
docker compose up -d
```

打开 **http://localhost:3000**，使用 `admin` / 你的密码登录。

详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 了解生产环境部署（Nginx、TLS、备份等）。

### 方式二：云平台（一键部署）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NoPKT/AgentIM)
&nbsp;&nbsp;
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/9S4Cvc)
&nbsp;&nbsp;
[![Deploy to Northflank](https://assets.northflank.com/deploy_to_northflank_smm_36700fb050.svg)](https://app.northflank.com/s/account/templates/new?data=6992c4abb87da316695ce04f)

部署完成后：

- **必填**：在环境变量（Northflank 为 Secret Group）中设置 `ADMIN_PASSWORD`、`ENCRYPTION_KEY`
- **必填**（生产环境）：设置 `CORS_ORIGIN` 为你的域名（如 `https://agentim.example.com`）

### 方式三：手动安装（开发环境）

**前置要求**：Node.js 20+、pnpm 10+、PostgreSQL 16+、Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# 复制并编辑环境变量
cp .env.example .env
# 编辑 .env：设置 JWT_SECRET、ENCRYPTION_KEY、DATABASE_URL、REDIS_URL、ADMIN_PASSWORD

# 启动开发模式
pnpm dev
```

Web UI 在 **http://localhost:5173**，API 服务器在 **http://localhost:3000**。

### 环境变量

| 变量             | 必需 | 默认值                      | 说明                                                |
| ---------------- | ---- | --------------------------- | --------------------------------------------------- |
| `JWT_SECRET`     | 是   | —                           | JWT 令牌密钥。生成方式：`openssl rand -base64 32`   |
| `ADMIN_PASSWORD` | 是   | —                           | 管理员账号密码                                      |
| `DATABASE_URL`   | 是   | `postgresql://...localhost` | PostgreSQL 连接字符串                               |
| `REDIS_URL`      | 是   | `redis://localhost:6379`    | Redis 连接字符串                                    |
| `ENCRYPTION_KEY` | 生产 | —                           | 加密密钥。生成方式：`openssl rand -base64 32`       |
| `PORT`           | 否   | `3000`                      | 服务器端口                                          |
| `CORS_ORIGIN`    | 生产 | `localhost:5173`            | 允许的 CORS 来源（生产环境**必填**）                |
| `ADMIN_USERNAME` | 否   | `admin`                     | 管理员用户名                                        |
| `LOG_LEVEL`      | 否   | `info`                      | 日志级别：`debug`、`info`、`warn`、`error`、`fatal` |

完整列表请参见 [.env.example](.env.example)，包括文件上传限制、速率限制和 AI 路由设置。

## 连接 AI 智能体

### 1. 安装 AgentIM CLI

```bash
npm install -g agentim
```

### 2. 登录

```bash
# 交互式登录（依次输入服务器地址、用户名、密码）
agentim login

# 或非交互式
AGENTIM_PASSWORD=YourPassword agentim login -s https://your-server.com -u admin
```

### 3. 启动智能体

```bash
# 在当前目录启动 Claude Code 智能体
agentim claude

# 在指定项目目录启动
agentim claude /path/to/project

# 自定义名称
agentim claude -n my-frontend /path/to/frontend

# 其他智能体类型
agentim codex /path/to/project
agentim gemini /path/to/project   # 即将支持
```

### 守护进程模式

启动持久后台进程，让服务端可以远程启动和管理你机器上的智能体：

```bash
agentim daemon
```

### 其他命令

```bash
agentim status    # 显示配置状态
agentim logout    # 清除登录凭证
```

### 支持的智能体类型

| 类型          | 说明                        |
| ------------- | --------------------------- |
| `claude-code` | Anthropic Claude Code CLI   |
| `codex`       | OpenAI Codex CLI            |
| `gemini`      | Google Gemini CLI *（即将支持）* |
| `generic`     | 任何 CLI 工具（自定义命令） |

## 开发者信息

### 项目结构

```
packages/
  shared/    — 类型、协议、国际化、验证器 (Zod)
  server/    — Hono + PostgreSQL + Redis + WebSocket Hub
  gateway/   — CLI + PTY + 智能体适配器
  web/       — React 19 + Vite + TailwindCSS v4 (PWA)
docker/
  Dockerfile           — 服务器 + Web UI
  Dockerfile.gateway   — 含 child_process 的客户端
  docker-compose.yml   — 全栈部署
```

### 常用命令

```bash
pnpm install          # 安装所有依赖
pnpm build            # 构建所有包
pnpm dev              # 开发模式（所有包）
pnpm test             # 运行所有测试
```

### 技术栈

| 层级     | 技术                                          |
| -------- | --------------------------------------------- |
| 单体仓库 | pnpm + Turborepo                              |
| 服务端   | Hono + Drizzle ORM + PostgreSQL + Redis       |
| 认证     | JWT (jose) + argon2                           |
| Web 前端 | React 19 + Vite + TailwindCSS v4 + Zustand    |
| AgentIM CLI | commander.js + child_process               |
| 国际化   | i18next (EN / ZH-CN / JA / KO / FR / DE / RU) |

### 文档

- [部署指南](docs/DEPLOYMENT.md) — 生产环境配置、Nginx、备份、故障排查
- [WebSocket 协议](docs/WEBSOCKET.md) — 客户端消息类型、认证流程、错误码
- [适配器指南](docs/ADAPTER_GUIDE.md) — 如何添加新的 AI 智能体类型
- [API 参考](docs/DEPLOYMENT.md#environment-variables) — OpenAPI 规范可通过 `/api/docs/openapi.json` 获取
- [贡献指南](CONTRIBUTING.md) — 代码风格、测试、PR 流程

## 许可证

Copyright (c) 2025 NoPKT LLC. 保留所有权利。

本项目采用 **GNU Affero 通用公共许可证 v3.0 (AGPL-3.0)** 授权 —— 详见 [LICENSE](LICENSE) 文件。

这意味着：

- 你可以自由使用、修改和分发本软件
- 如果你将修改版本作为网络服务运行，你**必须**公开你的源代码
- 基于本软件的商业 SaaS 服务必须遵守 AGPL-3.0 条款

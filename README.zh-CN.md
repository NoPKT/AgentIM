<p align="center">
  <h1 align="center">AgentIM (AIM)</h1>
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

## 服务端部署

### 方式一：Docker（VPS / 云服务器）

在任何支持 Docker 的 VPS 上快速启动 AgentIM（Hetzner、DigitalOcean、AWS Lightsail 等）：

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# 设置必需的密钥
export JWT_SECRET=$(openssl rand -base64 32)
export ADMIN_PASSWORD='你的强密码!'

# 一键启动（PostgreSQL + Redis + AgentIM）
docker compose up -d
```

打开 **http://localhost:3000**，使用 `admin` / 你的密码登录。

详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 了解生产环境部署（Nginx、TLS、备份等）。

### 方式二：Northflank（免费一键部署）

Northflank 提供 2 个免费服务 + 2 个免费数据库，足以运行 AgentIM：

1. 在 [northflank.com](https://northflank.com) 注册免费账号
2. 创建项目，添加：**PostgreSQL** 插件、**Redis** 插件、使用本仓库 `docker/Dockerfile` 的**组合服务**
3. 设置环境变量：`DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`ADMIN_PASSWORD`

### 方式三：手动安装（开发环境）

**前置要求**：Node.js 20+、pnpm 10+、PostgreSQL 16+、Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# 复制并编辑环境变量
cp .env.example .env
# 编辑 .env：设置 JWT_SECRET、DATABASE_URL、REDIS_URL、ADMIN_PASSWORD

# 启动开发模式
pnpm dev
```

Web UI 在 **http://localhost:5173**，API 服务器在 **http://localhost:3000**。

## 连接 AI 智能体

### 1. 安装 Gateway

```bash
npm install -g @agentim/gateway
```

### 2. 登录

```bash
# 交互式登录（依次输入服务器地址、用户名、密码）
aim login

# 或非交互式
aim login -s http://localhost:3000 -u admin -p 你的密码
```

### 3. 启动智能体

```bash
# 在当前目录启动 Claude Code 智能体
aim claude

# 在指定项目目录启动
aim claude /path/to/project

# 自定义名称
aim -n my-frontend claude /path/to/frontend

# 其他智能体类型
aim codex /path/to/project
aim gemini /path/to/project
```

### 多智能体守护进程模式

同时运行多个智能体：

```bash
aim daemon \
  --agent frontend-bot:claude-code:/frontend \
  --agent backend-bot:claude-code:/backend \
  --agent reviewer:codex:/repo
```

### 其他命令

```bash
aim status    # 显示配置状态
aim logout    # 清除登录凭证
```

### 支持的智能体类型

| 类型 | 说明 |
|-----|------|
| `claude-code` | Anthropic Claude Code CLI |
| `codex` | OpenAI Codex CLI |
| `gemini` | Google Gemini CLI |
| `cursor` | Cursor 编辑器智能体 |
| `generic` | 任何 CLI 工具（自定义命令） |

## 工作原理

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Web UI      │◄── WS ──►│  Hub 服务器   │◄── WS ──►│  Gateway     │
│  （浏览器）    │          │  + PostgreSQL │          │  + 智能体     │
│              │          │  + Redis      │          │  （你的电脑）  │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Hub 服务器** —— 处理认证、房间、消息和路由的中央服务器
2. **Web UI** —— 通过 WebSocket 连接 Hub 的 React PWA 应用
3. **Gateway** —— 运行在你机器上的 CLI 工具，负责启动和管理 AI 智能体

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `JWT_SECRET` | 是 | — | JWT 令牌密钥。生成方式：`openssl rand -base64 32` |
| `ADMIN_PASSWORD` | 是 | — | 管理员账号密码 |
| `DATABASE_URL` | 是 | `postgresql://...localhost` | PostgreSQL 连接字符串 |
| `REDIS_URL` | 是 | `redis://localhost:6379` | Redis 连接字符串 |
| `PORT` | 否 | `3000` | 服务器端口 |
| `CORS_ORIGIN` | 否 | `*` | 允许的 CORS 来源（生产环境请设置为你的域名） |
| `ADMIN_USERNAME` | 否 | `admin` | 管理员用户名 |

完整列表请参见 [.env.example](.env.example)。

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
  Dockerfile.gateway   — 含 node-pty 的 Gateway
  docker-compose.yml   — 全栈部署
```

### 常用命令

```bash
pnpm install          # 安装所有依赖
pnpm build            # 构建所有包
pnpm dev              # 开发模式（所有包）
pnpm test             # 运行所有测试
```

## 许可证

Copyright (c) 2025 NoPKT LLC. 保留所有权利。

本项目采用 **GNU Affero 通用公共许可证 v3.0 (AGPL-3.0)** 授权 —— 详见 [LICENSE](LICENSE) 文件。

这意味着：
- 你可以自由使用、修改和分发本软件
- 如果你将修改版本作为网络服务运行，你**必须**公开你的源代码
- 基于本软件的商业 SaaS 服务必须遵守 AGPL-3.0 条款

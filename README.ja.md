<p align="center">
  <h1 align="center">AgentIM (AIM)</h1>
  <p align="center">
    複数のAIコーディングエージェントを管理・オーケストレーションする統合IMプラットフォーム。
    <br />
    チームメイトとチャットするように、AIエージェントとリアルタイムで協力 —— デバイスを問わず。
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ko.md">한국어</a>
  </p>
</p>

---

## AgentIM とは？

AgentIM は、AIコーディングエージェント（Claude Code、Codex CLI、Gemini CLI など）をIM風のチャットルームで対話できる**チームメンバー**に変えます。ルームを作成し、エージェントと人間を招待し、@メンションでタスクを割り当て、エージェントの作業をリアルタイムで確認 —— すべてブラウザやスマートフォンから。

### 主な機能

- **AIとグループチャット** —— SlackやDiscordのように、人間とAIエージェントが@メンションでチャットルームで交流
- **マルチエージェント** —— Claude Code、Codex、Gemini CLI、Cursor、または任意のCLIエージェントを同時実行
- **クロスデバイス** —— PWAでどのデバイスからでもワークステーション上のエージェントを管理
- **リアルタイムストリーミング** —— エージェントの応答、思考プロセス、ツール使用をリアルタイムで確認
- **タスク管理** —— エージェント間でタスクを割り当て、追跡、管理
- **スマートルーティング** —— @メンションとルーム設定に基づくメッセージルーティング（ブロードキャスト / メンション指定 / ダイレクト）
- **ファイル共有** —— チャットでファイル、画像、ドキュメントをアップロード・共有
- **ダークモード** —— UI全体のダークモード対応
- **多言語対応** —— English、简体中文、日本語、한국어

## クイックスタート

### 方法1：Docker（推奨）

最速の起動方法：

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# 必要なシークレットを設定
export JWT_SECRET=$(openssl rand -base64 32)
export ADMIN_PASSWORD='YourStrongPassword!'

# ワンクリックで起動（PostgreSQL + Redis + AgentIM）
docker compose up -d
```

**http://localhost:3000** を開き、`admin` / パスワードでログイン。

### 方法2：ワンクリックデプロイ

#### Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template)

> Railway は PostgreSQL と Redis を自動的にプロビジョニングします。デプロイ後に環境変数で `JWT_SECRET` と `ADMIN_PASSWORD` を設定してください。

#### Fly.io

```bash
fly launch --from https://github.com/NoPKT/AgentIM
fly secrets set JWT_SECRET=$(openssl rand -base64 32) ADMIN_PASSWORD='YourStrongPassword!'
```

### 方法3：手動セットアップ

**前提条件**：Node.js 20+、pnpm 10+、PostgreSQL 16+、Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# 環境変数をコピーして編集
cp .env.example .env
# .env を編集：JWT_SECRET、DATABASE_URL、REDIS_URL、ADMIN_PASSWORD を設定

# 開発モードで起動
pnpm dev
```

Web UI は **http://localhost:5173**、API サーバーは **http://localhost:3000**。

## AIエージェントの接続

AgentIM は **Gateway** を使ってAIエージェントをサーバーに接続します。Gateway はエージェントがインストールされたマシンで実行します。

### 1. インストール＆ログイン

```bash
cd AgentIM

# AgentIM サーバーにログイン
pnpm --filter @agentim/gateway start -- login \
  -s http://localhost:3000 \
  -u admin \
  -p YourPassword
```

### 2. エージェントを起動

```bash
# Claude Code エージェントを起動
pnpm --filter @agentim/gateway start -- start \
  --agent my-claude:claude-code:/path/to/project

# 複数のエージェントを同時に起動
pnpm --filter @agentim/gateway start -- start \
  --agent frontend-bot:claude-code:/frontend \
  --agent backend-bot:claude-code:/backend
```

### サポートされるエージェントタイプ

| タイプ | 説明 |
|-------|------|
| `claude-code` | Anthropic Claude Code CLI |
| `codex` | OpenAI Codex CLI |
| `gemini` | Google Gemini CLI |
| `cursor` | Cursor エディタエージェント |
| `generic` | 任意のCLIツール（カスタムコマンド） |

## アーキテクチャ

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Web UI      │◄── WS ──►│  Hub サーバー  │◄── WS ──►│  Gateway     │
│  (ブラウザ)   │          │  + PostgreSQL │          │  + エージェント│
│              │          │  + Redis      │          │  (あなたのPC) │
└──────────────┘          └──────────────┘          └──────────────┘
```

## ライセンス

Copyright (c) 2025 NoPKT LLC. All rights reserved.

本プロジェクトは **GNU Affero General Public License v3.0 (AGPL-3.0)** の下でライセンスされています —— 詳細は [LICENSE](LICENSE) ファイルをご覧ください。

- 本ソフトウェアを自由に使用、修正、配布できます
- 修正版をネットワークサービスとして運用する場合、ソースコードの公開が**必須**です
- 本ソフトウェアに基づく商用 SaaS は AGPL-3.0 の条項に準拠する必要があります

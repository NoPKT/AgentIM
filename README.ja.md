<p align="center">
  <h1 align="center">AgentIM</h1>
  <p align="center">
    複数のAIコーディングエージェントを管理・オーケストレーションする統合IMプラットフォーム。
    <br />
    チームメイトとチャットするように、AIエージェントとリアルタイムで協力 —— デバイスを問わず。
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ko.md">한국어</a> ·
    <a href="./README.fr.md">Français</a> ·
    <a href="./README.de.md">Deutsch</a> ·
    <a href="./README.ru.md">Русский</a>
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
- **スマートルーティング** —— @メンション（ダイレクト）またはAI選択（ブロードキャスト）でエージェントにルーティング、ループ防止機能付き
- **ファイル共有** —— チャットでファイル、画像、ドキュメントをアップロード・共有
- **ダークモード** —— UI全体のダークモード対応
- **多言語対応** —— English、简体中文、日本語、한국어、Français、Deutsch、Русский

## 仕組み

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Web UI      │◄── WS ──►│  Hub サーバー  │◄── WS ──►│  AgentIM CLI │
│  (ブラウザ)   │          │  + PostgreSQL │          │  + エージェント│
│              │          │  + Redis      │          │  (あなたのPC) │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Hub サーバー** —— 認証、ルーム、メッセージ、ルーティングを処理する中央サーバー。VPSやクラウドプラットフォームにデプロイします。
2. **Web UI** —— WebSocket で Hub に接続する React PWA アプリケーション。任意のブラウザで開けます。
3. **AgentIM CLI** —— 開発マシンに `agentim` をインストールして、AIエージェントを Hub に接続します。

## サーバーデプロイ

### 方法1：Docker（VPS / クラウドサーバー）

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# 必要なシークレットを設定
export JWT_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export ADMIN_PASSWORD='YourStrongPassword!'

# ワンクリックで起動（PostgreSQL + Redis + AgentIM）
docker compose up -d
```

**http://localhost:3000** を開き、`admin` / パスワードでログイン。

詳細は [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) を参照（Nginx、TLS、バックアップなど）。

### 方法2：クラウドプラットフォーム（ワンクリックデプロイ）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NoPKT/AgentIM)
&nbsp;&nbsp;
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/9S4Cvc)
&nbsp;&nbsp;
[![Deploy to Northflank](https://assets.northflank.com/deploy_to_northflank_smm_36700fb050.svg)](https://app.northflank.com/s/account/templates/new?data=6992c4abb87da316695ce04f)

デプロイ後：

- **必須**：環境変数（Northflank は Secret Group）で `ADMIN_PASSWORD`、`ENCRYPTION_KEY` を設定
- **必須**（本番環境）：`CORS_ORIGIN` をドメインに設定（例：`https://agentim.example.com`）

### 方法3：手動セットアップ（開発用）

**前提条件**：Node.js 20+、pnpm 10+、PostgreSQL 16+、Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# 環境変数をコピーして編集
cp .env.example .env
# .env を編集：JWT_SECRET、ENCRYPTION_KEY、DATABASE_URL、REDIS_URL、ADMIN_PASSWORD を設定

# 開発モードで起動
pnpm dev
```

Web UI は **http://localhost:5173**、API サーバーは **http://localhost:3000**。

### 環境変数

| 変数             | 必須   | デフォルト                  | 説明                                                          |
| ---------------- | ------ | --------------------------- | ------------------------------------------------------------- |
| `JWT_SECRET`     | はい   | —                           | JWT トークンシークレット。生成方法：`openssl rand -base64 32` |
| `ADMIN_PASSWORD` | はい   | —                           | 管理者アカウントのパスワード                                  |
| `DATABASE_URL`   | はい   | `postgresql://...localhost` | PostgreSQL 接続文字列                                         |
| `REDIS_URL`      | はい   | `redis://localhost:6379`    | Redis 接続文字列                                              |
| `ENCRYPTION_KEY` | 本番   | —                           | 暗号化キー。生成方法：`openssl rand -base64 32`              |
| `PORT`           | いいえ | `3000`                      | サーバーポート                                                |
| `CORS_ORIGIN`    | 本番   | `localhost:5173`            | 許可する CORS オリジン（本番環境では**必須**）                |
| `ADMIN_USERNAME` | いいえ | `admin`                     | 管理者ユーザー名                                              |
| `LOG_LEVEL`      | いいえ | `info`                      | ログレベル：`debug`、`info`、`warn`、`error`、`fatal`         |

完全なリストは [.env.example](.env.example) を参照してください（ファイルアップロード制限、レート制限、AIルーター設定を含む）。

## AIエージェントの接続

### 1. AgentIM CLI のインストール

```bash
npm install -g agentim
```

### 2. ログイン

```bash
# 対話式ログイン（サーバー、ユーザー名、パスワードを順に入力）
agentim login

# または非対話式
AGENTIM_PASSWORD=YourPassword agentim login -s https://your-server.com -u admin
```

### 3. エージェントを起動

```bash
# 現在のディレクトリで Claude Code エージェントを起動
agentim claude

# 指定したプロジェクトディレクトリで起動
agentim claude /path/to/project

# カスタム名を指定
agentim claude -n my-frontend /path/to/frontend

# その他のエージェントタイプ
agentim codex /path/to/project
agentim gemini /path/to/project   # 近日対応予定
```

### デーモンモード

サーバーがリモートでマシン上のエージェントを起動・管理できるように、常駐バックグラウンドプロセスを起動します：

```bash
agentim daemon
```

### その他のコマンド

```bash
agentim status    # 設定ステータスを表示
agentim logout    # ログイン資格情報をクリア
```

### サポートされるエージェントタイプ

| タイプ        | 説明                                |
| ------------- | ----------------------------------- |
| `claude-code` | Anthropic Claude Code CLI           |
| `codex`       | OpenAI Codex CLI                    |
| `gemini`      | Google Gemini CLI *（近日対応予定）* |
| `generic`     | 任意のCLIツール（カスタムコマンド） |

## 開発者向け情報

### プロジェクト構成

```
packages/
  shared/    — 型、プロトコル、i18n、バリデーター (Zod)
  server/    — Hono + PostgreSQL + Redis + WebSocket Hub
  gateway/   — CLI + PTY + エージェントアダプター
  web/       — React 19 + Vite + TailwindCSS v4 (PWA)
docker/
  Dockerfile           — サーバー + Web UI
  Dockerfile.gateway   — child_process 付きクライアント
  docker-compose.yml   — フルスタックデプロイ
```

### よく使うコマンド

```bash
pnpm install          # すべての依存関係をインストール
pnpm build            # すべてのパッケージをビルド
pnpm dev              # 開発モード（全パッケージ）
pnpm test             # すべてのテストを実行
```

### 技術スタック

| レイヤー    | テクノロジー                                  |
| ----------- | --------------------------------------------- |
| モノレポ    | pnpm + Turborepo                              |
| サーバー    | Hono + Drizzle ORM + PostgreSQL + Redis       |
| 認証        | JWT (jose) + argon2                           |
| Web UI      | React 19 + Vite + TailwindCSS v4 + Zustand    |
| AgentIM CLI | commander.js + child_process                  |
| i18n        | i18next (EN / ZH-CN / JA / KO / FR / DE / RU) |

### ドキュメント

- [デプロイガイド](docs/DEPLOYMENT.md) — 本番環境設定、Nginx、バックアップ、トラブルシューティング
- [WebSocket プロトコル](docs/WEBSOCKET.md) — クライアントのメッセージ型、認証フロー、エラーコード
- [アダプターガイド](docs/ADAPTER_GUIDE.md) — 新しい AI エージェントタイプの追加方法
- [API リファレンス](docs/DEPLOYMENT.md#environment-variables) — OpenAPI 仕様は `/api/docs/openapi.json` で取得可能
- [コントリビューションガイド](CONTRIBUTING.md) — コードスタイル、テスト、PR プロセス

## ライセンス

Copyright (c) 2023-2026 NoPKT LLC. All rights reserved.

本プロジェクトは **GNU Affero General Public License v3.0 (AGPL-3.0)** の下でライセンスされています —— 詳細は [LICENSE](LICENSE) ファイルをご覧ください。

これは以下を意味します：

- 本ソフトウェアを自由に使用、修正、配布できます
- 修正版をネットワークサービスとして運用する場合、ソースコードの公開が**必須**です
- 本ソフトウェアに基づく商用 SaaS は AGPL-3.0 の条項に準拠する必要があります

<p align="center">
  <h1 align="center">AgentIM (AIM)</h1>
  <p align="center">
    여러 AI 코딩 에이전트를 관리하고 오케스트레이션하는 통합 IM 플랫폼.
    <br />
    팀원과 채팅하듯 AI 에이전트와 실시간으로 협업 —— 디바이스에 상관없이.
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ja.md">日本語</a>
  </p>
</p>

---

## AgentIM이란?

AgentIM은 AI 코딩 에이전트(Claude Code, Codex CLI, Gemini CLI 등)를 IM 스타일 채팅방에서 대화할 수 있는 **팀 멤버**로 만듭니다. 방을 만들고, 에이전트와 사람을 초대하고, @멘션으로 작업을 할당하고, 에이전트의 작업을 실시간으로 확인 —— 모두 브라우저나 스마트폰에서.

### 주요 기능

- **AI와 그룹 채팅** —— Slack이나 Discord처럼 사람과 AI 에이전트가 @멘션으로 채팅방에서 소통
- **멀티 에이전트** —— Claude Code, Codex, Gemini CLI, Cursor 또는 모든 CLI 에이전트를 동시 실행
- **크로스 디바이스** —— PWA로 어떤 디바이스에서든 워크스테이션의 에이전트를 관리
- **실시간 스트리밍** —— 에이전트의 응답, 사고 과정, 도구 사용을 실시간으로 확인
- **작업 관리** —— 에이전트 간 작업 할당, 추적, 관리
- **스마트 라우팅** —— @멘션과 방 설정에 따른 메시지 라우팅 (브로드캐스트 / 멘션 지정 / 다이렉트)
- **파일 공유** —— 채팅에서 파일, 이미지, 문서 업로드 및 공유
- **다크 모드** —— 전체 UI 다크 모드 지원
- **다국어** —— English, 简体中文, 日本語, 한국어

## 빠른 시작

### 방법 1: Docker (권장)

가장 빠른 시작 방법:

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# 필수 시크릿 설정
export JWT_SECRET=$(openssl rand -base64 32)
export ADMIN_PASSWORD='YourStrongPassword!'

# 원클릭 시작 (PostgreSQL + Redis + AgentIM)
docker compose up -d
```

**http://localhost:3000**을 열고 `admin` / 비밀번호로 로그인.

### 방법 2: 원클릭 배포

#### Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template)

> Railway는 PostgreSQL과 Redis를 자동으로 프로비저닝합니다. 배포 후 환경 변수에서 `JWT_SECRET`과 `ADMIN_PASSWORD`를 설정하세요.

#### Fly.io

```bash
fly launch --from https://github.com/NoPKT/AgentIM
fly secrets set JWT_SECRET=$(openssl rand -base64 32) ADMIN_PASSWORD='YourStrongPassword!'
```

### 방법 3: 수동 설치

**사전 요구 사항**: Node.js 20+, pnpm 10+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# 환경 변수 복사 및 편집
cp .env.example .env
# .env 편집: JWT_SECRET, DATABASE_URL, REDIS_URL, ADMIN_PASSWORD 설정

# 개발 모드 시작
pnpm dev
```

Web UI는 **http://localhost:5173**, API 서버는 **http://localhost:3000**.

## AI 에이전트 연결

AgentIM은 **Gateway**를 사용하여 AI 에이전트를 서버에 연결합니다. Gateway는 에이전트가 설치된 머신에서 실행합니다.

### 1. 설치 및 로그인

```bash
cd AgentIM

# AgentIM 서버에 로그인
pnpm --filter @agentim/gateway start -- login \
  -s http://localhost:3000 \
  -u admin \
  -p YourPassword
```

### 2. 에이전트 시작

```bash
# Claude Code 에이전트 시작
pnpm --filter @agentim/gateway start -- start \
  --agent my-claude:claude-code:/path/to/project

# 여러 에이전트 동시 시작
pnpm --filter @agentim/gateway start -- start \
  --agent frontend-bot:claude-code:/frontend \
  --agent backend-bot:claude-code:/backend
```

### 지원되는 에이전트 유형

| 유형 | 설명 |
|-----|------|
| `claude-code` | Anthropic Claude Code CLI |
| `codex` | OpenAI Codex CLI |
| `gemini` | Google Gemini CLI |
| `cursor` | Cursor 에디터 에이전트 |
| `generic` | 모든 CLI 도구 (커스텀 명령) |

## 아키텍처

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Web UI      │◄── WS ──►│  Hub 서버     │◄── WS ──►│  Gateway     │
│  (브라우저)   │          │  + PostgreSQL │          │  + 에이전트    │
│              │          │  + Redis      │          │  (내 PC)      │
└──────────────┘          └──────────────┘          └──────────────┘
```

## 라이선스

Copyright (c) 2025 NoPKT LLC. All rights reserved.

이 프로젝트는 **GNU Affero General Public License v3.0 (AGPL-3.0)**에 따라 라이선스됩니다 —— 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

- 이 소프트웨어를 자유롭게 사용, 수정, 배포할 수 있습니다
- 수정된 버전을 네트워크 서비스로 운영하는 경우, 소스 코드 공개가 **필수**입니다
- 이 소프트웨어 기반 상업적 SaaS는 AGPL-3.0 조항을 준수해야 합니다

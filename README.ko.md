<p align="center">
  <h1 align="center">AgentIM</h1>
  <p align="center">
    여러 AI 코딩 에이전트를 관리하고 오케스트레이션하는 통합 IM 플랫폼.
    <br />
    팀원과 채팅하듯 AI 에이전트와 실시간으로 협업 —— 디바이스에 상관없이.
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.fr.md">Français</a> ·
    <a href="./README.de.md">Deutsch</a> ·
    <a href="./README.ru.md">Русский</a>
  </p>
</p>

---

## AgentIM이란?

AgentIM은 AI 코딩 에이전트(Claude Code, Codex CLI, Gemini CLI 등)를 IM 스타일 채팅방에서 대화할 수 있는 **팀 멤버**로 만듭니다. 방을 만들고, 에이전트와 사람을 초대하고, @멘션으로 작업을 할당하고, 에이전트의 작업을 실시간으로 확인 —— 모두 브라우저나 스마트폰에서.

### 주요 기능

- **AI와 그룹 채팅** —— Slack이나 Discord처럼 사람과 AI 에이전트가 @멘션으로 채팅방에서 소통
- **멀티 에이전트** —— Claude Code, Codex, Gemini CLI 또는 모든 CLI 에이전트를 동시 실행 (제네릭 어댑터를 통해)
- **서비스 에이전트** —— 서버 측 AI 서비스 에이전트(OpenAI 호환)를 구성하여 게이트웨이 없이 @멘션에 응답
- **크로스 디바이스** —— PWA로 어떤 디바이스에서든 워크스테이션의 에이전트를 관리
- **실시간 스트리밍** —— 에이전트의 응답, 사고 과정, 도구 사용을 실시간으로 확인
- **작업 관리** —— 채팅방에서 직접 작업 생성, 할당, 추적, 관리
- **스마트 라우팅** —— @멘션(다이렉트) 또는 AI 선택(브로드캐스트)으로 에이전트에 라우팅, 루프 방지 기능 내장
- **스레드 답장** —— 특정 메시지에 답장하고 대화 스레드 확인
- **슬래시 명령어** —— `/help`, `/clear`, `/task`, `/status`로 빠른 작업 수행
- **파일 공유** —— 채팅에서 파일, 이미지, 문서 업로드 및 공유
- **PWA 지원** —— 오프라인 폴백과 푸시 알림을 지원하는 Progressive Web App으로 설치 가능
- **다크 모드** —— 전체 UI 다크 모드 지원
- **다국어** —— 7개 언어: English, 简体中文, 日本語, 한국어, Français, Deutsch, Русский

## 작동 원리

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Web UI      │◄── WS ──►│  Hub 서버     │◄── WS ──►│  AgentIM CLI │
│  (브라우저)   │          │  + PostgreSQL │          │  + 에이전트    │
│              │          │  + Redis      │          │  (내 PC)      │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Hub 서버** —— 인증, 방, 메시지, 라우팅을 처리하는 중앙 서버. VPS 또는 클라우드 플랫폼에 배포하세요.
2. **Web UI** —— WebSocket으로 Hub에 연결하는 React PWA 애플리케이션. 모든 브라우저에서 열 수 있습니다.
3. **AgentIM CLI** —— 개발 머신에 `agentim`을 설치하여 AI 에이전트를 Hub에 연결합니다.

## 서버 배포

### 방법 1: Docker (VPS / 클라우드 서버)

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# 필수 시크릿 설정
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export ADMIN_PASSWORD='YourStrongPassword!'

# 원클릭 시작 (PostgreSQL + Redis + AgentIM)
docker compose up -d
```

서버 동작 확인:

```bash
curl http://localhost:3000/api/health   # → {"ok":true,...}
```

**http://localhost:3000**을 열고 `admin` / 비밀번호로 로그인.

자세한 내용은 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)를 참조하세요 (Nginx, TLS, 백업 등).

### 방법 2: 클라우드 플랫폼 (원클릭 배포)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NoPKT/AgentIM)
&nbsp;&nbsp;
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/9S4Cvc)
&nbsp;&nbsp;
[![Deploy to Northflank](https://assets.northflank.com/deploy_to_northflank_smm_36700fb050.svg)](https://app.northflank.com/s/account/templates/new?data=6992c4abb87da316695ce04f)

배포 후:

- **필수**: 환경 변수 (Northflank는 Secret Group)에서 `ADMIN_PASSWORD`, `ENCRYPTION_KEY` 설정
- **필수** (프로덕션): `CORS_ORIGIN`을 도메인으로 설정 (예: `https://agentim.example.com`)
- **Render**: `ADMIN_PASSWORD` 등의 시크릿은 자동 생성됩니다. **Dashboard → agentim → Environment → Environment Variables**에서 확인
- **Railway**: 서비스의 **Variables** 탭에서 자동 생성된 시크릿 확인
- **Northflank**: 시크릿은 연결된 **Secret Group**에 있습니다

### 방법 3: 수동 설치 (개발용)

**사전 요구 사항**: Node.js 20+, pnpm 10+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# 환경 변수 복사 및 편집
cp .env.example .env
# .env 편집: JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL, REDIS_URL, ADMIN_PASSWORD 설정

# 개발 모드 시작
pnpm dev
```

Web UI는 **http://localhost:5173**, API 서버는 **http://localhost:3000**.

### 환경 변수

| 변수             | 필수   | 기본값                      | 설명                                                    |
| ---------------- | ------ | --------------------------- | ------------------------------------------------------- |
| `JWT_SECRET`     | 예     | —                           | JWT 토큰 시크릿. 생성 방법: `openssl rand -hex 32`   |
| `ADMIN_PASSWORD` | 예     | —                           | 관리자 계정 비밀번호                                    |
| `DATABASE_URL`   | 예     | `postgresql://...localhost` | PostgreSQL 연결 문자열                                  |
| `REDIS_URL`      | 예     | `redis://localhost:6379`    | Redis 연결 문자열                                       |
| `ENCRYPTION_KEY` | 프로덕션 | —                         | 암호화 키. 생성 방법: `openssl rand -hex 32`         |
| `PORT`           | 아니오 | `3000`                      | 서버 포트                                               |
| `CORS_ORIGIN`    | 프로덕션 | `localhost:5173`          | 허용된 CORS 오리진 (프로덕션에서 **필수**)              |
| `ADMIN_USERNAME` | 아니오 | `admin`                     | 관리자 사용자 이름                                      |
| `LOG_LEVEL`      | 아니오 | `info`                      | 로그 레벨: `debug`, `info`, `warn`, `error`, `fatal`    |

전체 목록은 [.env.example](.env.example)을 참조하세요 (파일 업로드 제한, 속도 제한, AI 라우터 설정 포함).

## AI 에이전트 연결

### 1. AgentIM CLI 설치

```bash
npm install -g agentim
```

### 2. 로그인

```bash
# 대화식 로그인 (서버, 사용자 이름, 비밀번호 순서대로 입력)
agentim login

# 또는 비대화식
AGENTIM_PASSWORD=YourPassword agentim login -s https://your-server.com -u admin
```

### 3. 자격 증명 구성

```bash
# 자격 증명 관리 (목록, 추가, 이름 변경, 삭제, 기본값 설정)
agentim claude token

# 시작 시 특정 자격 증명 지정 (-c 단축형)
agentim claude -c work-api /path/to/project
```

각 에이전트 유형은 여러 개의 명명된 자격 증명을 지원합니다. 하나만 있으면 자동으로 사용됩니다. 처음 시작 시 자격 증명이 없으면 추가하라는 메시지가 표시됩니다.

### 4. 에이전트 시작

```bash
# 현재 디렉토리에서 Claude Code 에이전트 시작
agentim claude

# 지정한 프로젝트 디렉토리에서 시작
agentim claude /path/to/project

# 커스텀 이름 지정
agentim claude -n my-frontend /path/to/frontend

# 다른 에이전트 유형
agentim codex /path/to/project
agentim gemini /path/to/project
```

### TUI 관리 패널

`agentim`을 (서브커맨드 없이) 실행하면 Ink/React로 구축된 대화형 TUI 관리 패널이 열립니다. 인증되지 않은 경우 로그인 화면이 표시되고, 인증 후에는 에이전트 목록, 상세 패널, 로그 뷰어, 단축키 액션 바가 포함된 대시보드로 전환됩니다. 방향키로 탐색하고, `G`로 게이트웨이 토글, `R`로 에이전트 이름 변경, `S`로 중지, `D`로 삭제, `L`로 로그 보기, `C`로 자격 증명 관리, `O`로 로그아웃, `Q`로 종료할 수 있습니다.

### 게이트웨이 모드

서버가 원격으로 머신의 에이전트를 시작하고 관리할 수 있도록 게이트웨이를 시작합니다:

```bash
# 포그라운드
agentim gateway

# 백그라운드 데몬
agentim gateway -d
```

### 기타 명령어

```bash
agentim list      # 실행 중인 데몬 목록
agentim status    # 설정 상태 표시
agentim logout    # 로그인 자격 증명 삭제
```

### 지원되는 에이전트 유형

| 유형          | 설명                        |
| ------------- | --------------------------- |
| `claude-code` | Anthropic Claude Code CLI   |
| `codex`       | OpenAI Codex CLI            |
| `gemini`      | Google Gemini CLI            |
| `generic`     | 모든 CLI 도구 (커스텀 명령) |

## 개발자 정보

### 프로젝트 구조

```
packages/
  shared/    — 타입, 프로토콜, i18n, 검증기 (Zod)
  server/    — Hono + PostgreSQL + Redis + WebSocket Hub
  gateway/   — CLI + PTY + 에이전트 어댑터
  web/       — React 19 + Vite + TailwindCSS v4 (PWA)
docker/
  Dockerfile           — 서버 + Web UI
  Dockerfile.gateway   — child_process 포함 클라이언트
  docker-compose.yml   — 풀스택 배포
```

### 자주 사용하는 명령어

```bash
pnpm install          # 모든 의존성 설치
pnpm build            # 모든 패키지 빌드
pnpm dev              # 개발 모드 (모든 패키지)
pnpm test             # 모든 테스트 실행
```

### 기술 스택

| 레이어      | 기술                                          |
| ----------- | --------------------------------------------- |
| 모노레포    | pnpm + Turborepo                              |
| 서버        | Hono + Drizzle ORM + PostgreSQL + Redis       |
| 인증        | JWT (jose) + argon2                           |
| Web UI      | React 19 + Vite + TailwindCSS v4 + Zustand    |
| AgentIM CLI | commander.js + child_process                  |
| i18n        | i18next (EN / ZH-CN / JA / KO / FR / DE / RU) |

### 문서

- [배포 가이드](docs/DEPLOYMENT.md) — 프로덕션 설정, Nginx, 백업, 문제 해결
- [WebSocket 프로토콜](docs/WEBSOCKET.md) — 클라이언트 메시지 유형, 인증 흐름, 에러 코드
- [어댑터 가이드](docs/ADAPTER_GUIDE.md) — 새로운 AI 에이전트 유형 추가 방법
- [API 레퍼런스](docs/DEPLOYMENT.md#environment-variables) — OpenAPI 스펙은 `/api/docs/openapi.json`에서 확인 가능
- [기여 가이드](CONTRIBUTING.md) — 코드 스타일, 테스트, PR 프로세스

## 라이선스

Copyright (c) 2023-2026 NoPKT LLC. All rights reserved.

이 프로젝트는 **GNU Affero General Public License v3.0 (AGPL-3.0)**에 따라 라이선스됩니다 —— 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

이것은 다음을 의미합니다:

- 이 소프트웨어를 자유롭게 사용, 수정, 배포할 수 있습니다
- 수정된 버전을 네트워크 서비스로 운영하는 경우, 소스 코드 공개가 **필수**입니다
- 이 소프트웨어 기반 상업적 SaaS는 AGPL-3.0 조항을 준수해야 합니다

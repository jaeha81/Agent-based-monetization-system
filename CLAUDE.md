# Claude Code Instructions — shorts-dashboard

> Context Pack: `G:\내 드라이브\obsidian-agent-brain-system\ObsidianVault\06_Context_Packs\bucky-shorts-dashboard.md`

## Role

Claude Code는 이 프로젝트의 구현/운영 에이전트다.
Bucky가 지시 패킷을 발행하고, Claude Code가 패킷 범위 내에서 구현한다.
Codex가 독립 검수한다.

## Project

- **경로**: `D:\ai프로젝트\쇼츠자동화\shorts-dashboard`
- **배포**: https://shorts-dashboard-one.vercel.app (Vercel)
- **실행**: `npm run dev` → http://localhost:3000

## Allowed Scope (기본)

Bucky 패킷의 `scope.allowed_files` 가 명시된 경우 그것을 따른다.
패킷 없이 직접 작업 시 기본 허용 범위:

- `src/lib/` — 비즈니스 로직 / API 클라이언트
- `src/app/api/` — API 라우트
- `src/app/` — 페이지 컴포넌트
- `src/components/` — UI 컴포넌트
- `vercel.json` — Cron 스케줄 (변경 전 사용자 확인)

## ⛔ 절대 금지

- `.env` 파일 생성·수정·읽기·출력 (로컬 `.env` 민감정보 포함)
- Vercel 환경변수 추가·수정 — 사용자 명시 승인 필요
- YouTube OAuth 토큰 교체 — 사용자 명시 승인 필요
- DB 스키마 변경 (테이블/컬럼 추가·삭제) — 사용자 명시 승인 필요
- `git push` / Vercel 배포 — 사용자 명시 승인 필요
- Shotstack stage 변경 (sandbox→production) — 사용자 명시 승인 필요
- `node_modules/` 파일 직접 수정

## 완료 보고 필수 형식

```
작업: <무엇을 했는지>
증거: <실행 명령어> → <실제 출력>
실행 전: <이전 상태>
실행 후: <현재 상태>
미완료: <못 한 것 명시>
```

## Verification Gates

| 체크 | 명령어 |
|---|---|
| 타입 에러 | `npm run build` |
| Lint | `npm run lint` |
| 워크플로우 상태 | `GET /api/workflow/status` |
| Gemini 연결 | `GET /api/products` (상품 발굴 응답 확인) |

## Bucky Activation

Bucky 패킷 없이 대형 작업 착수 시:

```powershell
cd "G:\내 드라이브\obsidian-agent-brain-system"
python -X utf8 scripts/context_pack_selector.py --packet --project "shorts-dashboard" "<요청 내용>"
```

## 관련 Context Pack

`G:\내 드라이브\obsidian-agent-brain-system\ObsidianVault\06_Context_Packs\bucky-shorts-dashboard.md`

Bucky 패킷 발행 시 이 팩을 참조해 `scope`, `approval_gates`, `verification` 필드를 채운다.

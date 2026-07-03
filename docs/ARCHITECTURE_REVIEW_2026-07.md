# 쇼츠 자동화 시스템 — 아키텍처 리뷰 문서

> 작성일: 2026-07-03 · 기준 코드: `claude/charming-faraday-76e8nw` (master 머지 완료 시점)
> 배포: https://shorts-dashboard-one.vercel.app

---

## 1. 전체 아키텍처 (한 문단 요약)

이 시스템은 **Next.js 14(App Router) 단일 앱을 Vercel에 올린 서버리스 어필리에이트 쇼츠 자동화 파이프라인**이다. 매일 Vercel 크론(17:00 UTC)이 워크플로우 엔진을 깨우면, 쿠팡 파트너스 API에서 트렌드 상품을 발굴해 Turso(libSQL) DB에 적재하고, Gemini 2.5 Flash로 후킹 스크립트·시나리오를 생성한 뒤, Google Veo 2로 8초 세로형 광고 영상을 생성한다(실패 시 Shotstack 템플릿 렌더로 폴백). 두 번째 크론(21:00 UTC)이 렌더 완료를 폴링해 YouTube Data API로 쇼츠를 업로드(컴플라이언스상 비공개 상태)하고, 같은 영상을 Vercel Blob 공개 URL로 변환해 Instagram Reels·TikTok에 워터폴 배포한다. 업로드 직후 쿠팡 제휴 링크를 고정 댓글로 게시해 시청자를 구매 페이지로 유도하며, 수익은 쿠팡 파트너스 커미션이 핵심이다. 잡 오케스트레이션은 DB 테이블(`workflow_jobs`) 기반의 자체 제작 노드 그래프 엔진이 담당하고, `autofix` 자가수리 엔드포인트가 실패 잡 재시도와 시스템 건강도 스캔을 수행한다.

```
[크론 17:00] → 상품발굴(쿠팡API) → 콘텐츠생성(Gemini) → 영상렌더(Veo2/Shotstack) --waiting--┐
[크론 21:00] → 렌더폴링 ──────────────────────────────────────────────────────────────────┘
                  └→ YouTube 업로드(비공개) → CTA 고정댓글 → Blob 공개URL → IG Reels + TikTok
                                                          └→ 수익동기화 · Discord 알림
```

---

## 2. 쇼츠 영상 생성 단계 (데이터 소스 → 업로드)

| 단계 | 노드 | 하는 일 | 산출물 |
|---|---|---|---|
| 1 | `product_discovery` | 쿠팡 파트너스 Open API로 키워드 검색(요일별 키워드 로테이션: 트렌드 핫템/다이소/뷰티/육아/홈트 등), 제휴 단축링크 생성 | `products` 행 + 딥링크 |
| 2 | `content_generation` | Gemini 2.5 Flash가 훅·스크립트·해시태그 생성 (체험형 표현 금지 등 컴플라이언스 프롬프트 내장), 플랫폼별 콘텐츠 분기 | `content` 행 (draft) |
| 3 | `video_render` | ① 씬 시나리오 생성(4씬: 훅→성능→가격→CTA) + Stability AI SD3로 제품 이미지 생성(병렬) ② Veo 2 `predictLongRunning` 제출 → 실패 시 Shotstack 폴백 | `render_id`, 잡 상태 `waiting` |
| 4 | 렌더 폴링 | 21:00 크론(또는 autofix 수동 호출)이 Veo LRO / Shotstack 상태 확인, Shotstack은 webhook으로도 재개 | 영상 URI |
| 5 | `youtube_upload` | 영상 다운로드 → YouTube Data API 멀티파트 업로드. **비공개(private)** + `paidProductPlacementDetails` + AI 생성 고지 첫 줄 배치. 업로드 직후 구매링크 고정 댓글 게시 | YouTube videoId |
| 6 | `instagram_reel` / `tiktok_video` | 영상을 Vercel Blob에 올려 공개 URL 확보(IG/TT는 공개 URL 필수) → Graph API/TikTok Open API로 업로드 → Blob 삭제 | 멀티플랫폼 배포 |
| 7 | `revenue_sync` / `notify` | 조회수 동기화, Discord Webhook 알림 | 대시보드 지표 |

---

## 3. 사용 중인 AI 모델과 API

| 용도 | 모델/API | 비고 |
|---|---|---|
| 스크립트·시나리오 생성 | **Gemini 2.5 Flash** (`generativelanguage.googleapis.com`) | ⚠️ 파일명이 `claude-client.ts`인데 실제로는 Gemini 호출 (기술부채) |
| 영상 생성 (1순위) | **Google Veo 2** (`veo-2.0-generate-001:predictLongRunning`) | 8초, 9:16, LRO 패턴. 쿼터 약 10~15편/일 |
| 영상 생성 (폴백) | **Shotstack** 렌더 API | 템플릿 합성 방식, webhook 콜백 |
| 제품 이미지 | **Stability AI SD3** (`stable-image/generate/sd3`) | Shotstack Ingest로 호스팅 |
| TTS 나레이션 | **Google Cloud TTS** (Wavenet, ko/ja/en) | `/api/tts` |
| 상품 데이터 | **쿠팡 파트너스 Open API** (HMAC 서명) | 검색 + 딥링크 생성 |
| 업로드 | **YouTube Data API v3** (OAuth refresh token) · **Instagram Graph API v21** · **TikTok Open API v2** | |
| 임시 스토리지 | **Vercel Blob** | Veo 영상 → IG/TT용 공개 URL 변환 |
| 알림 | Discord Webhook | |

---

## 4. 자동화 vs 수동

**자동화됨:**
- 상품 발굴 → 콘텐츠 → 영상 → 3플랫폼 업로드 전체 파이프라인 (일 1사이클)
- 제휴 딥링크 생성, CTA 고정 댓글, 공시 문구 삽입
- 렌더 폴링·실패 잡 재시도(autofix), 조회수 동기화, Discord 알림
- 클릭 트래킹 (`/api/tracking/click` 리다이렉트 경유)

**사람이 해야 함:**
- ⭐ **YouTube 영상 최종 검토 후 비공개→공개 전환** (컴플라이언스 설계상 의도된 게이트 — 이걸 안 하면 조회수·수익 0)
- 상품 승인/거절 (`PATCH /api/products/{id}/approve` — 선택적 게이트)
- Vercel 환경변수·API 키 관리, YouTube OAuth 토큰 갱신
- 쿠팡 파트너스 수수료 실적 확인 (partners.coupang.com — API 미연동, 수동 입력 테이블 존재)
- Shotstack sandbox→production 전환, Vercel 배포 승인

---

## 5. 상품 데이터 소스

- **주 소스: 쿠팡 파트너스 Open API** (`api-gateway.coupang.com`, HMAC-SHA256 인증). 키워드 검색으로 상품명·가격·평점·커미션율 수집, 딥링크 생성.
- **폴백: 코드에 하드코딩된 큐레이션 상품 목록** — `COUPANG_ACCESS_KEY` 미설정이거나 API 실패 시 자동 사용. ⚠️ 이 경우 실제 재고·가격과 무관한 데이터로 영상이 만들어질 수 있음 (리스크 섹션 참고).
- 알리익스프레스·네이버·다이소는 **미연동**. DB에 `affiliate_program` 컬럼(기본 'coupang')과 `target_market` 컬럼이 있어 확장 여지는 마련되어 있으나 구현체는 쿠팡뿐.

---

## 6. 수익화 구조

**설계된 목표: 제휴(어필리에이트) 커미션 단일 축.**
- 쿠팡 파트너스 딥링크 → 영상 설명란 + 고정 댓글 → 구매 시 커미션 (상품별 ~3%)
- 1개 영상을 YouTube+IG+TikTok 3플랫폼에 배포해 Veo 쿼터 대비 도달 극대화
- 클릭 트래킹으로 콘텐츠별 전환 성과 측정 (`click_logs`)
- YouTube 애드센스 수익은 Analytics API로 **조회만** 시도 (수익화 조건 미달 시 0) — 주 수익원 아님
- 공동구매·자체 판매·광고 협찬은 현재 **설계에 없음**. `revenue_accounts`(정산 계좌)·`manual_revenue_entries`(수동 수익 입력) 테이블이 있어 회계 기록은 가능.

---

## 7. 데이터베이스

**Turso (libSQL = 호스팅 SQLite)** — `aws-ap-northeast-1` 리전. 로컬 개발 시 파일 SQLite 폴백. 스키마는 코드 내 `CREATE TABLE IF NOT EXISTS` + try-catch식 `ALTER TABLE` 마이그레이션 배열로 관리 (마이그레이션 도구 없음).

| 테이블 | 저장 내용 |
|---|---|
| `products` | 상품 (이름·카테고리·쿠팡URL·커미션율·바이럴점수·승인상태) |
| `content` | 생성 콘텐츠 (훅·스크립트·영상URL·render_id·컴플라이언스 상태·조회수) |
| `workflow_jobs` | 워크플로우 잡 큐 (노드타입·상태·입출력 JSON·render_id) — 오케스트레이션의 심장 |
| `scheduled_posts` | 플랫폼별 게시 예약/발행 기록 (youtube_video_id 포함) |
| `click_logs` | 제휴링크 클릭 트래킹 (IP해시·UA) |
| `revenue_logs` / `manual_revenue_entries` / `revenue_accounts` | 수익 기록·수동 입력·정산 계좌 |
| `agent_states` / `agent_tasks` / `evolution_log` / `brain_problems` | 에이전트 상태·자가수리 사이클·감지된 문제 |
| `accounts` / `automation_runs` / `settings` | 플랫폼 계정, 실행 이력, 설정 |

---

## 8. 배포/호스팅 구조

- **Vercel Hobby 플랜 단일** (프론트+API+크론 전부). 별도 백엔드 서버·큐 서비스 없음.
- 함수 제한: 일반 API 60초, 크론 300초, webhook 120초. **크론 2개 제한 + 하루 1회 실행** (17:00 파이프라인, 21:00 폴링·업로드 — UTC 기준, 한국시간 02:00/06:00).
- 외부 의존: Turso(DB), Vercel Blob(임시 영상), Google(Gemini/Veo/TTS/YouTube), 쿠팡, Meta, TikTok, Stability, Shotstack, Discord.
- 장시간 작업은 서버리스 제약을 피하려고 **DB 잡 큐 + waiting 상태 + 폴링/webhook** 패턴으로 우회.
- CI/CD·테스트 없음. 로컬 PC에서 master 머지 → `git push` → Vercel 자동 배포.

---

## 9. "AI 공동구매 플랫폼"으로 확장하려면

현재 시스템은 **트래픽 생성기**(콘텐츠→클릭→외부 구매)다. 공동구매는 **거래 플랫폼**이므로 다음이 신규로 필요하다:

1. **사용자 계정·인증** — 현재 회원 개념 없음(대시보드 로그인만 존재). 소셜 로그인, 참여자 관리 필수.
2. **결제·주문 시스템** — PG 연동(토스페이먼츠/포트원), 주문·환불·배송 상태 테이블. 현재 DB에 거래 엔티티가 전혀 없음.
3. **공동구매 도메인 모델** — 딜(목표수량·마감시간·달성률), 참여자, 가격 티어. `products` 테이블을 공급가·재고·공급사 연결로 확장.
4. **공급사/재고 관리** — 쿠팡 딥링크 모델에서는 재고 개념이 없음. 직매입 또는 위탁 계약 관리 백오피스 필요.
5. **법적 요건** — 통신판매업 신고, 전자상거래법상 청약철회, 개인정보처리방침. 현재 어필리에이트(광고) 규제만 대응되어 있음.
6. **인프라 격상** — Hobby 플랜 크론 2개/일 1회, 60초 함수로는 실시간 거래 불가. Vercel Pro + 전용 큐(Upstash QStash 등) + 실DB 트랜잭션 검토. Turso(SQLite)는 결제 동시성에서 한계 가능.
7. **재사용 가능한 자산**: 콘텐츠 생성 파이프라인은 "딜 홍보 영상 자동 생성기"로 그대로 전용 가능 — 상품 소스만 쿠팡 API → 자체 딜 DB로 바꾸면 됨. 클릭 트래킹은 전환 퍼널 측정으로 확장.

**요약: 콘텐츠 엔진(70%)은 재사용, 커머스 레이어(계정·결제·딜·재고·법무)는 0에서 신축.**

---

## 10. 가장 큰 병목·기술 리스크 & 개선 우선순위 Top 5

### 병목
- **① 사람 게이트에서 파이프라인이 끝남**: 영상이 비공개로 업로드되고 공개 전환을 사람이 안 하면 조회수·클릭·수익이 전부 0. 자동화의 마지막 1미터가 끊겨 있음.
- **② Veo 쿼터 (~10-15편/일)**: 영상 생산량의 물리적 상한. "다작"이 아니라 "상품 선별의 질"이 수익을 결정하는 구조인데, 상품 선정 로직은 아직 키워드 검색 + viral_score 정렬 수준.
- **③ 일 1사이클 배치**: Hobby 크론 제약으로 하루 한 번만 돈다. 실패하면 다음날까지 복구 기회 없음.

### 기술 리스크
- **크리덴셜 수명**: YouTube refresh token 만료/폐기 시 업로드 전면 중단 (알림 없음). 쿠팡 키 미설정 시 조용히 하드코딩 상품으로 폴백 → **허위 가격 영상 생성 가능** (법적 리스크로 직결).
- **관측성 부재**: 테스트 0, 에러 알림은 Discord 일부뿐. 이번 "자동 업로드 중단"도 크론 설정 유실을 며칠간 아무도 몰랐던 사례.
- **기술부채**: `claude-client.ts`가 실제론 Gemini 호출(오해 유발), try-catch식 DB 마이그레이션, git 브랜치 이원화(master vs 작업 브랜치)로 배포본 혼동 반복.

### 개선 우선순위 Top 5

| # | 항목 | 이유 | 난이도 |
|---|---|---|---|
| 1 | **검토 큐 UI + 원클릭 공개 전환** (비공개 영상 목록 → 미리보기 → 승인 시 `privacyStatus: public` PATCH) | 수익 발생의 마지막 관문. 지금은 YouTube Studio 수동 조작 | 하 |
| 2 | **파이프라인 헬스 알림** (크론 미실행·잡 실패·토큰 만료 감지 → Discord/이메일 즉시 통보) | 무증상 장애 재발 방지. 이번 장애의 직접 교훈 | 하 |
| 3 | **쿠팡 폴백 차단 + 상품 검증 강화** (API 키 없으면 큐레이션 폴백 대신 파이프라인 중단; 가격·재고 재확인 후 렌더) | 허위 광고 법적 리스크 제거. 컴플라이언스 문서(JH-SHORTS-COMPLIANCE)와 일관 | 하 |
| 4 | **상품 선정 지능화** (커미션율×검색량×경쟁도 스코어링, 성과 데이터 피드백 루프 — `click_logs`→viral_score 갱신) | Veo 쿼터가 상한인 구조에서 편당 기대수익이 유일한 레버 | 중 |
| 5 | **배포·브랜치 단일화 + 최소 테스트** (master 단일 트렁크, 크론 설정 스냅샷 테스트, 빌드 시 vercel.json 크론 개수 검증) | master/브랜치 이원화로 수정사항 유실·크론 삭제 사고가 이미 발생 | 중 |

---

## 부록: 개발자에게 꼭 물어봐야 할 질문 리스트

1. YouTube refresh token은 언제 발급됐고, 만료·폐기 시 감지 방법이 있는가?
2. 쿠팡 파트너스 키가 지금 실제로 설정되어 있는가? (폴백 큐레이션 상품으로 영상이 나간 적 있는가?)
3. Veo 호출이 Gemini Pro **구독**으로 커버되는가, 아니면 API **종량 과금**이 별도로 나가는가? 월 예상 비용은?
4. 비공개로 쌓인 영상이 현재 몇 개이고, 공개 전환 기준(검토 체크리스트)은 문서화되어 있는가?
5. Turso 무료 티어 한도(행 읽기/쓰기)에 현재 사용량이 어느 정도인가?

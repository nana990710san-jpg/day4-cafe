# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 상태

골목카페 운영 대시보드. 5개 페이지와 Edge Function `cafe-ai`가 모두 만들어져 있다. 기능 · 데이터 · AI 요구사항은 [PRD.md](PRD.md)를 기준으로 하며, PRD의 "정해야 할 것" 항목은 임의로 확정하지 말고 사용자에게 먼저 묻는다.

## 기술 조건 (PRD에서 정한 제약)

- **페이지 = HTML 파일 하나.** `index.html`, `sales.html`, `menu.html`, `reviews.html`, `promo.html` 5개. 페이지를 더 만들지 않는다.
- **npm · 빌드 도구 · 프레임워크 없음.** 라이브러리(Supabase JS, 그래프 라이브러리)는 CDN `<script>`로만 불러온다. `package.json`을 만들지 않는다.
- **DB:** 사용자의 Supabase 프로젝트 `day4-cafe`. 브라우저에는 공개 키(publishable/anon)만 둔다.
- **AI:** Supabase Edge Function `cafe-ai` 하나 (소스: `supabase/functions/cafe-ai/index.ts`, verify_jwt 꺼짐). `POST {type, data}`:
  - `review` `{content, rating?}` → `{sentiment: 좋음|보통|아쉬움, reply}`
  - `promo` `{menu: 이름 또는 {name, price}, mood, note?}` → `{captions: [3개]}`
  - `brief` `{오늘 숫자 아무 필드}` → `{lines: [3줄]}`
  - 실패 시 `{error, details}` (HTTP 502). OpenRouter 무료 모델 `liquid/lfm-2.5-2.6b:free` → `google/gemma-4-31b-it:free` 순으로 시도. 키는 Secrets `OPENROUTER_API_KEY`에서만 읽는다.
  - 배포는 Supabase 커넥터 `deploy_edge_function`(verify_jwt=false)로, 저장소 파일 내용과 같게 한다.
  - `reviews.sentiment` 체크 제약도 좋음/보통/아쉬움이다 (migration `reviews_sentiment_labels`).
  - 페이지에서는 `fetch(SUPABASE_URL + '/functions/v1/cafe-ai')`로 부르고, 무료 모델이라 1~2분 걸리거나 502로 실패할 수 있으니 진행 중 표시와 `body.error` 안내를 꼭 둔다.

## 구조 (big picture)

- `index.html`은 **틀**이다: 왼쪽 메뉴 + 가운데 `<iframe>`. 메뉴를 누르면 iframe `src`가 다른 페이지 HTML로 바뀐다. 홈을 누르면 iframe을 숨기고 index 안의 `#home` 영역(숫자 카드 4개 · 7일 매출 막대(CSS, 라이브러리 없음) · AI 오늘 브리핑)을 보여주며, 홈에 올 때마다 숫자를 다시 읽는다.
- 나머지 4개 페이지는 iframe 안에서 단독으로 동작한다. 각 파일이 스스로 Supabase 클라이언트를 만들고 필요한 테이블을 읽고 쓴다.
- 판매 저장 · 취소는 `sales`에 직접 insert/delete 하지 말고 DB 함수 `record_sale(p_menu_id, p_quantity)` / `cancel_sale(p_sale_id)`를 `db.rpc()`로 부른다. 이 함수가 판매 기록과 `menus.stock` 차감·복구를 한 트랜잭션으로 처리하고, 재고보다 많이 팔면 에러를 낸다 (security invoker, anon에 EXECUTE).
- "오늘"은 브라우저 현지 시각 자정부터(`sold_at >= 오늘 0시`)로 계산한다.
- 테이블(Supabase에 생성됨): `menus`, `sales`, `reviews`. 컬럼은 PRD.md 8절. `sales`는 `menu_id`와 함께 `menu_name`도 저장해 메뉴가 지워져도 기록이 남는다.
- 로그인이 없으므로 세 테이블 모두 `anon`에 SELECT/INSERT/UPDATE/DELETE 권한 + RLS 모두 허용 정책이 걸려 있다. 스키마 변경은 Supabase 커넥터의 `apply_migration`으로 한다.

## 디자인 규칙

Supabase 주소와 공개 키(`sb_publishable_…`)는 각 페이지 `<script>` 맨 위 `SUPABASE_URL` / `SUPABASE_KEY` 상수로 넣는다 (menu.html 참고). supabase-js는 CDN `@supabase/supabase-js@2.45.4` UMD로 불러온다.

모든 페이지가 같은 색과 글꼴을 쓴다. 각 HTML 파일 맨 위에 **동일한 CSS 변수 블록**을 두므로, 색 · 글꼴을 바꿀 때는 5개 파일을 모두 똑같이 고친다.

## 실행

빌드 없음. 이 PC에는 Python · Node가 없으므로 저장소의 PowerShell 정적 서버를 쓴다 (`.claude/launch.json`의 `cafe` 설정과 같음):

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8000
```

`index.html`은 `HEAD` 요청으로 각 페이지 파일이 있는지 확인하고, 없으면 iframe에 "준비중" 화면을 띄운다. 그래서 `file://`로 직접 열면 모든 페이지가 "준비중"으로 보인다. 반드시 서버로 연다.

## 기타

- 화면 문구와 AI 출력은 한국어. 사용자는 IT 지식이 많지 않은 동네 카페 사장님이므로 쉬운 말과 큰 숫자 · 큰 버튼을 쓴다.
- 기본 브랜치는 `main`, 원격은 `origin` (GitHub `nana990710san-jpg/day4-cafe`).

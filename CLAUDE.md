# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 상태

골목카페 운영 대시보드. 6개 페이지와 Edge Function `cafe-ai`가 모두 만들어져 있다. 기능 · 데이터 · AI 요구사항은 [PRD.md](PRD.md)를 기준으로 하며, PRD의 "정해야 할 것" 항목은 임의로 확정하지 말고 사용자에게 먼저 묻는다.

## 기술 조건 (PRD에서 정한 제약)

- **페이지 = HTML 파일 하나.** `index.html`, `sales.html`, `menu.html`, `reviews.html`, `promo.html`, `rivals.html`(주변 카페, 사용자 요청으로 추가) 6개. 사용자가 요청하지 않으면 페이지를 더 만들지 않는다.
- **손님용 홈페이지 `homepage.html`은 대시보드와 별개다** ([PRD-homepage.md](PRD-homepage.md)). 아래 "공통 블록"을 쓰지 않고 자기 `:root`를 가진다. 대시보드도 같은 무화과 · 레몬 · 레이스 톤을 쓰므로, 색 값을 바꿀 때는 두 쪽을 함께 맞춘다. DB는 `menus` · `reviews`를 **select만** 하고 쓰기 코드를 넣지 않으며, 대시보드로 가는 링크를 두지 않는다. 가게 정보(이름 · 주소 · 시간 · 시그니처)는 파일 맨 위 `CAFE` 객체에서만 고친다. 무드 사진 `무화과 레이스 (1~7).jpg`는 참고용이라 페이지에 넣지 않는다(출처 불명, 한 장은 Pinterest 표시).
- `rivals.html`은 API 키 없이 구글 지도 임베드(`maps.google.com/maps?q=…&output=embed`)와 카카오맵 검색 링크만 쓴다. Supabase를 쓰지 않는다.
- **npm · 빌드 도구 · 프레임워크 없음.** 라이브러리(Supabase JS, 그래프 라이브러리)는 CDN `<script>`로만 불러온다. `package.json`을 만들지 않는다.
- **DB:** 사용자의 Supabase 프로젝트 `day4-cafe`. 브라우저에는 공개 키(publishable/anon)만 둔다.
- **AI:** Supabase Edge Function `cafe-ai` 하나 (소스: `supabase/functions/cafe-ai/index.ts`, verify_jwt 꺼짐). `POST {type, data}`:
  - `review` `{content, rating?}` → `{sentiment: 좋음|보통|아쉬움, reply}`
  - `promo` `{menu: 이름 또는 {name, price}, mood, note?}` → `{captions: [3개]}`
  - `brief` `{오늘 숫자 아무 필드}` → `{lines: [3줄]}`
  - 실패 시 `{error}`만 (HTTP 502, 자세한 이유는 함수 로그에만). OpenRouter 무료 모델 `liquid/lfm-2.5-2.6b:free` → `google/gemma-4-31b-it:free` 순으로 시도하되 호출당 40초, 전체 130초 안에 끝낸다(Supabase 150초 제한). 키는 Secrets `OPENROUTER_API_KEY`에서만 읽는다.
  - 배포는 Supabase 커넥터 `deploy_edge_function`(verify_jwt=false)로, 저장소 파일 내용과 같게 한다.
  - `reviews.sentiment` 체크 제약도 좋음/보통/아쉬움이다 (migration `reviews_sentiment_labels`).
  - 페이지에서는 공통 `askAI(type, data)`로만 부른다. 응답 필드까지 확인하고, 실패하면 "AI가 지금 바빠서…" 안내로 바꿔 던진다. 1~2분 걸릴 수 있으니 진행 중 표시와 버튼 잠금/해제(`finally`)를 꼭 둔다.

## 구조 (big picture)

- `index.html`은 **틀**이다: 왼쪽 메뉴 + 가운데 `<iframe>`. 메뉴를 누르면 iframe `src`가 다른 페이지 HTML로 바뀐다. 홈을 누르면 iframe을 숨기고 index 안의 `#home` 영역(숫자 카드 4개 · 7일 매출 막대(CSS, 라이브러리 없음) · AI 오늘 브리핑)을 보여주며, 홈에 올 때마다 숫자를 다시 읽는다.
- 나머지 페이지는 iframe 안에서 단독으로 동작한다. 왼쪽 메뉴를 빠르게 바꿔 눌러도 마지막 클릭만 반영한다(`openSeq`).
- `menu.html`은 바뀐 칸만 저장하고, 재고는 `.eq('stock', 화면을 열 때 값)` 조건으로 저장한다. 그사이 판매로 재고가 바뀌었으면 덮어쓰지 않고 다시 불러온다. 각 파일이 스스로 Supabase 클라이언트를 만들고 필요한 테이블을 읽고 쓴다.
- 판매 저장 · 취소는 `sales`에 직접 insert/delete 하지 말고 DB 함수 `record_sale(p_menu_id, p_quantity)` / `cancel_sale(p_sale_id)`를 `db.rpc()`로 부른다. 이 함수가 판매 기록과 `menus.stock` 차감·복구를 한 트랜잭션으로 처리하고, 재고보다 많이 팔면 에러를 낸다 (security invoker, anon에 EXECUTE).
- "오늘"은 브라우저 현지 시각 자정부터(`sold_at >= 오늘 0시`)로 계산한다.
- 테이블(Supabase에 생성됨): `menus`, `sales`, `reviews`. 컬럼은 PRD.md 8절. `sales`는 `menu_id`와 함께 `menu_name`도 저장해 메뉴가 지워져도 기록이 남는다.
- 로그인이 없으므로 세 테이블 모두 `anon`에 SELECT/INSERT/UPDATE/DELETE 권한 + RLS 모두 허용 정책이 걸려 있다. 스키마 변경은 Supabase 커넥터의 `apply_migration`으로 한다.

## 디자인 규칙

Supabase 주소와 공개 키(`sb_publishable_…`)는 각 페이지 `<script>` 맨 위 `SUPABASE_URL` / `SUPABASE_KEY` 상수로 넣는다 (menu.html 참고). supabase-js는 CDN `@supabase/supabase-js@2.45.4` UMD로 불러온다.

톤: 손님용 홈페이지와 같은 **무화과 · 레몬 · 레이스**. 아이보리 바탕, 무화과 자주(`--fig`) 주색, 레몬 · 바질 · 금빛 강조, 제목과 큰 숫자는 명조(`--serif` Gowun Batang), 본문은 Pretendard. 밝은 카드에는 아주 옅은 무화과색 점 그물(`--net`)을 깐다. 버건디 면(index 왼쪽 메뉴, 대표 숫자 카드 `.stat.dark` · `.total.dark`)에는 `--lace` = `assets/lace-ivory.png`를 깐다. 이 PNG는 사용자가 준 레이스 사진에서 **실만 따낸 아이보리 선(투명 바탕, 최대 불투명도 22%)**이다. 사진 원본은 저장소에 넣지 않는다. 금색 레이스 무늬는 "너무 튄다"고 해서 대시보드에서 모두 뺐다(`--gold`는 리뷰 별 색에만 남음). 무늬 진하기를 바꾸려면 PNG를 다시 만든다(원본에서 밝기 192~226을 0~1로 바꾸고 `-Max` 배율을 곱함). CSS opacity로 바꾸면 글자까지 흐려진다. 버튼은 알약 모양. 큰 글자 · 44px 버튼 같은 사장님용 크기 규칙은 그대로다. Google Fonts 링크(Cormorant Garamond, Gowun Batang)는 각 페이지 `<head>`에 같은 줄로 둔다.

대시보드 6개 페이지(homepage.html 제외)가 글자 하나까지 같은 블록을 쓴다. 바꿀 때는 6개 파일을 모두 똑같이 고친다:
- CSS `:root` 변수 블록 (색 `--fig` · `--fig-deep` · `--fig-soft` · `--linen` · `--lemon` · `--basil` · `--gold` · `--danger-soft`, 글꼴 `--font` · `--serif` · `--accent`, 무늬 `--lace` · `--net`). index.html의 "준비중" 화면이 이 블록을 정규식으로 복사하므로 값 안에 `}`를 넣지 않는다
- CSS "공통 모양" 블록 (body 여백 24px/좁은 화면 16px, 명조 `h1` · `h2`, `.card`, 입력칸, `.btn` · `.btn-line` 높이 44px 알약, `.btn-ghost` 44×44 원, `.toast`)
- JS "공통 도우미" 블록 (`$`, `esc`, `won`, `toast`, `friendly`) — rivals.html은 쓰지 않아 없음
- JS "AI 호출" 블록 (`askAI`) — index · reviews · promo

화면 문구 규칙: 해요체, 토스트 · 안내 문구 끝에 마침표를 찍지 않는다. Supabase · 네트워크 에러 원문(영어)은 화면에 보이지 말고 `friendly(err)`로 바꾼다 (원문은 `console.error`).

`index.html`만 사이드바 때문에 좁은 화면 기준이 820px이고, 나머지는 720px이다.

## 실행

빌드 없음. 이 PC에는 Python · Node가 없으므로 저장소의 PowerShell 정적 서버를 쓴다 (`.claude/launch.json`의 `cafe` 설정과 같음):

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8000
```

`serve.ps1`은 점으로 시작하는 경로(`.git`, `.claude`)를 404로 막는다. 이 파일은 **ASCII만** 쓴다 (Windows PowerShell 5.1이 BOM 없는 UTF-8을 ANSI로 읽어 한글 주석이 다음 줄 코드를 삼킨 적이 있다). HttpListener는 http.sys를 쓰므로 포트로 프로세스를 찾을 수 없다. 서버를 끌 때는 명령줄에 `serve.ps1`이 있는 powershell 프로세스를 찾는다.

`index.html`은 `HEAD` 요청으로 각 페이지 파일이 있는지 확인하고, 없으면 iframe에 "준비중" 화면을 띄운다. 그래서 `file://`로 직접 열면 모든 페이지가 "준비중"으로 보인다. 반드시 서버로 연다.

## 기타

- 화면 문구와 AI 출력은 한국어. 사용자는 IT 지식이 많지 않은 동네 카페 사장님이므로 쉬운 말과 큰 숫자 · 큰 버튼을 쓴다.
- 기본 브랜치는 `main`, 원격은 `origin` (GitHub `nana990710san-jpg/day4-cafe`).

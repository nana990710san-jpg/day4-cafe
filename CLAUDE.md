# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 상태

골목카페 운영 대시보드. 지금은 기획 단계라 [PRD.md](PRD.md)만 있고 코드는 아직 없다. 기능 · 데이터 · AI 요구사항은 모두 PRD.md를 기준으로 하며, PRD의 "정해야 할 것" 항목은 임의로 확정하지 말고 사용자에게 먼저 묻는다.

## 기술 조건 (PRD에서 정한 제약)

- **페이지 = HTML 파일 하나.** `index.html`, `sales.html`, `menu.html`, `reviews.html`, `promo.html` 5개. 페이지를 더 만들지 않는다.
- **npm · 빌드 도구 · 프레임워크 없음.** 라이브러리(Supabase JS, 그래프 라이브러리)는 CDN `<script>`로만 불러온다. `package.json`을 만들지 않는다.
- **DB:** 사용자의 Supabase 프로젝트 `day4-cafe`. 브라우저에는 공개 키(publishable/anon)만 둔다.
- **AI:** Supabase Edge Function `cafe-ai` 하나. 요청 본문의 `type`(`review_reply` · `promo` · `briefing`)으로 작업을 나눈다. AI API 키는 Edge Function Secrets에만 둔다.

## 구조 (big picture)

- `index.html`은 **틀**이다: 왼쪽 메뉴 + 가운데 `<iframe>`. 메뉴를 누르면 iframe `src`가 다른 페이지 HTML로 바뀐다. 홈 내용(숫자 카드 · 7일 매출 그래프 · AI 오늘 브리핑)도 index가 담당한다.
- 나머지 4개 페이지는 iframe 안에서 단독으로 동작한다. 각 파일이 스스로 Supabase 클라이언트를 만들고 필요한 테이블을 읽고 쓴다.
- 판매 저장(`sales`)은 재고 차감(`menu_items.stock`)과 함께 일어나야 한다. 판매 삭제 시 재고를 되돌린다.
- 테이블: `menu_items`, `sales`, `reviews`, `promos` (컬럼은 PRD.md 8절).

## 디자인 규칙

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

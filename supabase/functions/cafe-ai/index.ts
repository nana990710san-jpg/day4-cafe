// cafe-ai: 골목카페 대시보드의 AI 기능 하나로 모음
//   POST { type: "review", data: { content, rating? } }        → { sentiment, reply }
//   POST { type: "promo",  data: { menu, mood, note? } }       → { captions: [3개] }
//   POST { type: "brief",  data: { ...오늘 숫자 } }             → { lines: [3줄] }
// OpenRouter 키는 Secrets의 OPENROUTER_API_KEY에서만 읽는다. verify_jwt는 꺼져 있다.

const MODELS = ["liquid/lfm-2.5-2.6b:free", "google/gemma-4-31b-it:free"];
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const SENTIMENTS = ["좋음", "보통", "아쉬움"];
// Supabase Edge Function은 약 150초에 강제로 끝난다. 그 전에 한국어 에러로 답하도록 전체 마감을 둔다.
const DEADLINE_MS = 130_000;
const CALL_TIMEOUT_MS = 40_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

class BadRequest extends Error {}

const SYSTEM = `너는 동네 골목 카페 사장님을 돕는 비서야. 항상 한국어로, 따뜻하고 쉬운 말로 써.
반드시 요청한 JSON 객체 하나만 출력해. 설명, 마크다운, 코드블록은 쓰지 마.`;

type Task = { prompt: string; check: (o: any) => any };

function buildTask(type: string, data: any): Task {
  if (type === "review") {
    const content = String(data?.content ?? "").trim();
    if (!content) throw new BadRequest("review에는 data.content(리뷰 내용)가 필요해요");
    const rating = data?.rating ? `별점: ${data.rating}점 (5점 만점)\n` : "";
    return {
      prompt: `손님 리뷰를 읽고 감정을 "좋음", "보통", "아쉬움" 중 하나로 고르고, 사장님이 올릴 답글 초안을 2~4문장으로 써.
아쉬운 리뷰에는 변명 없이 사과하고 고칠 점을 약속해. 이모지는 최대 1개.
${rating}리뷰: ${content}

출력 형식: {"sentiment": "좋음|보통|아쉬움", "reply": "답글"}`,
      check: (o) => {
        const sentiment = SENTIMENTS.find((s) => String(o?.sentiment ?? "").includes(s));
        const reply = String(o?.reply ?? "").trim();
        if (!sentiment || !reply) return null;
        return { sentiment, reply };
      },
    };
  }

  if (type === "promo") {
    const menu = typeof data?.menu === "object" ? data.menu : { name: data?.menu };
    if (!String(menu?.name ?? "").trim()) throw new BadRequest("promo에는 data.menu(메뉴 이름)가 필요해요");
    const mood = String(data?.mood ?? "따뜻한").trim();
    const price = menu.price ? ` (${Number(menu.price).toLocaleString("ko-KR")}원)` : "";
    const note = data?.note ? `\n추가 메모: ${data.note}` : "";
    return {
      prompt: `골목 카페의 SNS(인스타그램) 홍보 문구를 서로 다른 느낌으로 3개 써.
각 문구는 2~3문장, 끝에 해시태그 3~5개. 과장 광고나 사실이 아닌 할인 정보는 넣지 마.
추가 메모가 있으면 위의 길이 · 해시태그 규칙보다 메모를 먼저 따라.
메뉴: ${menu.name}${price}
분위기: ${mood}${note}

출력 형식: {"captions": ["문구1", "문구2", "문구3"]}`,
      check: (o) => {
        const captions = Array.isArray(o?.captions) ? o.captions.map((c: unknown) => String(c).trim()).filter(Boolean) : [];
        return captions.length >= 3 ? { captions: captions.slice(0, 3) } : null;
      },
    };
  }

  if (type === "brief") {
    if (!data || typeof data !== "object" || !Object.keys(data).length) {
      throw new BadRequest("brief에는 data(오늘 숫자: 매출, 판매 수, 재고 부족 등)가 필요해요");
    }
    return {
      prompt: `아래 오늘 가게 숫자를 보고 사장님께 드릴 브리핑을 딱 세 줄로 써.
1줄: 오늘 장사 요약(숫자 포함), 2줄: 눈여겨볼 점, 3줄: 지금 할 일 한 가지. 각 줄은 한 문장.
오늘 숫자(JSON): ${JSON.stringify(data)}

출력 형식: {"lines": ["첫째 줄", "둘째 줄", "셋째 줄"]}`,
      check: (o) => {
        const lines = Array.isArray(o?.lines) ? o.lines.map((l: unknown) => String(l).trim()).filter(Boolean) : [];
        return lines.length >= 3 ? { lines: lines.slice(0, 3) } : null;
      },
    };
  }

  throw new BadRequest(`type은 review, promo, brief 중 하나여야 해요 (받은 값: ${type || "없음"})`);
}

// 모델 답에서 JSON 객체만 꺼내기 (코드블록 등이 섞여도)
function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callModel(model: string, prompt: string, key: string, timeoutMs: number): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Golmok Cafe Dashboard",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => {
    throw new Error(`${model}: ${e?.name === "TimeoutError" ? `${timeoutMs / 1000}초 안에 응답 없음` : e?.message ?? e}`);
  });
  const raw = await res.text().catch((e) => {
    throw new Error(`${model}: 응답을 끝까지 받지 못함 (${e?.name ?? e})`);
  });
  let body: any = null;
  try { body = JSON.parse(raw); } catch { /* 아래에서 처리 */ }
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${body?.error?.message ?? ""}`.trim());
  const text = body?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${model}: 빈 응답 ${raw.trim().slice(0, 300)}`);
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST로 요청해 주세요" }, 405);

  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return json({ error: "서버에 OPENROUTER_API_KEY가 설정되지 않았어요" }, 500);

  let task: Task;
  let type: string;
  try {
    const body = await req.json();
    type = String(body?.type ?? "");
    task = buildTask(type, body?.data);
  } catch (e) {
    const msg = e instanceof BadRequest ? e.message : "요청 본문이 올바른 JSON이 아니에요";
    return json({ error: msg }, 400);
  }

  // 첫 모델이 실패하거나 형식이 틀리면 다음 모델로 (전체 마감 안에서만)
  const started = Date.now();
  const timeLeft = () => DEADLINE_MS - (Date.now() - started);
  const callTimeout = () => Math.min(CALL_TIMEOUT_MS, timeLeft());
  const errors: string[] = [];
  for (const model of MODELS) {
    if (timeLeft() < 10_000) {
      errors.push(`${model}: 시간이 모자라 건너뜀`);
      continue;
    }
    try {
      let text: string;
      try {
        text = await callModel(model, task.prompt, key, callTimeout());
      } catch (e) {
        // 무료 모델은 잠깐씩 429(요청 많음)를 낸다: 시간이 남으면 3초 뒤 한 번만 다시
        if (!String(e).includes("HTTP 429") || timeLeft() < 15_000) throw e;
        errors.push(`${model}: 429, 다시 시도`);
        await new Promise((r) => setTimeout(r, 3000));
        text = await callModel(model, task.prompt, key, callTimeout());
      }
      const result = task.check(parseJson(text));
      if (result) return json({ type, model, ...result });
      errors.push(`${model}: 형식이 맞지 않는 응답`);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  // 자세한 이유는 함수 로그에만 남기고, 브라우저에는 안내 문구만 보낸다
  console.error("cafe-ai failed", type, errors);
  return json({ error: "AI가 지금 바빠서 답을 못 했어요. 1~2분 뒤에 다시 눌러 주세요" }, 502);
});

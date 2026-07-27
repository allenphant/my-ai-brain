"use strict";

const DEFAULT_SYSTEM_PROMPT = [
  "你是可靠的繁體中文研究助理。",
  "只根據提供的來源整理，不得補寫來源沒有提到的事實。",
  "回傳 JSON，不要 Markdown。",
  "必須包含 tldr、verdict、notes、suggestedTags、limitations。",
  "suggestedTags 最多 5 個簡短繁體中文詞彙。",
  "若來源有影片但無法解析，必須在 limitations 明確說明。",
].join("\n");

class ExternalServiceError extends Error {
  constructor(message, {
    provider,
    status = 0,
    retryable = false,
    retryAfterSeconds = 0,
    details = "",
  } = {}) {
    super(message);
    this.name = "ExternalServiceError";
    this.provider = provider || "unknown";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details;
  }
}

function parseRetryAfter(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)) : 0;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 90_000) {
  const {provider = "unknown", ...fetchOptions} = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...fetchOptions, signal: controller.signal});
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ExternalServiceError("外部服務逾時", {
        provider,
        retryable: true,
      });
    }
    throw new ExternalServiceError(error?.message || "外部服務連線失敗", {
      provider,
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseErrorResponse(response) {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.message || text;
  } catch {
    return text.slice(0, 1000);
  }
}

function serviceErrorFromResponse(provider, response, details) {
  const retryable = response.status === 429 || response.status >= 500;
  return new ExternalServiceError(`${provider} HTTP ${response.status}`, {
    provider,
    status: response.status,
    retryable,
    retryAfterSeconds: parseRetryAfter(response),
    details,
  });
}

async function readWithJina(sourceUrl, apiKey = "") {
  const headers = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
    "X-Remove-Selector": "header, footer, nav, script, style",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetchWithTimeout(
    `https://r.jina.ai/${sourceUrl}`,
    {headers, provider: "jina"},
    90_000,
  );
  if (!response.ok) {
    throw serviceErrorFromResponse("jina", response, await parseErrorResponse(response));
  }
  const text = (await response.text()).trim();
  if (!text) {
    throw new ExternalServiceError("Jina Reader 沒有回傳可整理文字", {
      provider: "jina",
      retryable: false,
    });
  }
  return text.slice(0, 120_000);
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function normalizeResearchResult(value, sourceUrl) {
  const parsed = value && typeof value === "object" ? value : {};
  const suggestedTags = Array.isArray(parsed.suggestedTags) ?
    parsed.suggestedTags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean)
      .slice(0, 5) :
    [];
  return {
    tldr: String(parsed.tldr || "").trim(),
    verdict: String(parsed.verdict || "").trim(),
    notes: String(parsed.notes || "").trim(),
    suggestedTags,
    limitations: String(parsed.limitations || "").trim(),
    sourceUrl,
  };
}

function extractGenerateContentText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("\n")
    .trim() || "";
}

function extractInteractionText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const stepTexts = (data?.steps || []).flatMap((step) =>
    (step?.content || []).map((part) => part?.text || ""),
  );
  const outputTexts = (data?.outputs || []).flatMap((output) =>
    (output?.content || []).map((part) => part?.text || ""),
  );
  return [...stepTexts, ...outputTexts].filter(Boolean).join("\n").trim();
}

async function analyzeWebSource({
  sourceUrl,
  geminiApiKey,
  jinaApiKey = "",
  model,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
}) {
  const sourceText = await readWithJina(sourceUrl, jinaApiKey);
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      provider: "gemini",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      body: JSON.stringify({
        systemInstruction: {parts: [{text: systemPrompt}]},
        contents: [{
          role: "user",
          parts: [{
            text: `請整理以下來源。\n來源網址：${sourceUrl}\n\n來源文字：\n${sourceText}`,
          }],
        }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    },
    120_000,
  );
  if (!response.ok) {
    throw serviceErrorFromResponse("gemini", response, await parseErrorResponse(response));
  }
  const data = await response.json();
  const text = extractGenerateContentText(data);
  if (!text) {
    throw new ExternalServiceError("Gemini 沒有回傳內容", {
      provider: "gemini",
      retryable: false,
    });
  }
  try {
    return normalizeResearchResult(JSON.parse(stripJsonFence(text)), sourceUrl);
  } catch {
    throw new ExternalServiceError("Gemini 回傳的 JSON 無法解析", {
      provider: "gemini",
      retryable: false,
      details: text.slice(0, 500),
    });
  }
}

async function analyzeYouTubeSource({
  sourceUrl,
  geminiApiKey,
  model,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
}) {
  const response = await fetchWithTimeout(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      provider: "gemini-video",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      body: JSON.stringify({
        model,
        system_instruction: systemPrompt,
        input: [
          {type: "video", uri: sourceUrl},
          {
            type: "text",
            text: [
              "分析此影片的聲音與畫面。",
              "回傳 JSON：tldr、verdict、notes、suggestedTags、limitations。",
              "notes 應包含重要時間點；無法存取影片時不可猜測。",
            ].join("\n"),
          },
        ],
      }),
    },
    240_000,
  );
  if (!response.ok) {
    throw serviceErrorFromResponse(
      "gemini-video",
      response,
      await parseErrorResponse(response),
    );
  }
  const data = await response.json();
  const text = extractInteractionText(data);
  if (!text) {
    throw new ExternalServiceError("Gemini Video 沒有回傳內容", {
      provider: "gemini-video",
      retryable: false,
    });
  }
  try {
    return normalizeResearchResult(JSON.parse(stripJsonFence(text)), sourceUrl);
  } catch {
    throw new ExternalServiceError("Gemini Video 回傳的 JSON 無法解析", {
      provider: "gemini-video",
      retryable: false,
      details: text.slice(0, 500),
    });
  }
}

async function analyzeSource(options) {
  if (!options.geminiApiKey) {
    throw new ExternalServiceError("尚未設定 GEMINI_API_KEY", {
      provider: "gemini",
      status: 401,
      retryable: false,
    });
  }
  return options.sourceKind === "youtube" ?
    analyzeYouTubeSource(options) :
    analyzeWebSource(options);
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  ExternalServiceError,
  analyzeSource,
  analyzeWebSource,
  analyzeYouTubeSource,
  extractGenerateContentText,
  extractInteractionText,
  normalizeResearchResult,
  readWithJina,
  stripJsonFence,
};

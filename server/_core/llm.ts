/**
 * LLM Helper — Google Gemini
 *
 * Manus forge yerine Gemini API kullanılır.
 *
 * Free tier (gemini-2.5-flash-lite, Nisan 2026):
 *   - 15 istek/dakika
 *   - 1000 istek/gün
 *   - 250k token/dakika
 *   - 1M context window
 *   - ÜCRETSİZ (kredi kartı yok)
 *
 * UYARI: Free tier'da Google, prompt'larınızı modeli eğitmek için kullanabilir.
 * Privacy policy'nizde bunu belirtmeniz gerekir.
 *
 * Mevcut kod (xfilter.router.ts) `invokeLLM(params)` çağırıyor ve
 * `result.choices[0].message.content` okuyor — bu kontratı koruyoruz.
 */

import { ENV } from "./env";

// ===== Tipler — eski Manus tipleriyle uyumlu (xfilter.router.ts değişmesin) =====

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
export type FileContent = { type: "file_url"; file_url: { url: string; mime_type?: string } };
export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { name: string }
  | { type: "function"; function: { name: string } };

export type OutputSchema = { name: string; schema: Record<string, unknown>; strict?: boolean };
export type ResponseFormat = { type: "json_schema"; json_schema?: { schema?: Record<string, unknown> } } | { type: "text" } | { type: "json_object" };

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatChoice = {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: string;
};

export type InvokeResult = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

// ===== Gemini API çağrısı =====

/**
 * Mesajları Gemini formatına çevir.
 * - "system" rolü Gemini'de yok; ilk system mesajını systemInstruction'a alıyoruz.
 * - "assistant" → "model"
 * - Multipart content (image, vs) şimdilik destekli değil — sade metin.
 */
function buildGeminiPayload(params: InvokeParams): {
  body: Record<string, unknown>;
  url: string;
} {
  const messages = params.messages;
  let systemInstruction: string | null = null;
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const msg of messages) {
    const text = extractText(msg.content);
    if (msg.role === "system") {
      // Gemini systemInstruction tek bir string — birden fazla varsa birleştir
      systemInstruction = systemInstruction ? `${systemInstruction}\n\n${text}` : text;
      continue;
    }
    if (msg.role === "tool" || msg.role === "function") {
      // Tool çıktısını user mesajı olarak ekleyelim — basit fallback
      contents.push({ role: "user", parts: [{ text: `[tool result] ${text}` }] });
      continue;
    }
    const geminiRole: "user" | "model" = msg.role === "assistant" ? "model" : "user";
    contents.push({ role: geminiRole, parts: [{ text }] });
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: params.maxTokens || params.max_tokens || 1024,
      temperature: 0.7,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  // JSON output isteniyorsa
  const respFormat = params.responseFormat || params.response_format;
  if (respFormat?.type === "json_object" || respFormat?.type === "json_schema") {
    (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    ENV.geminiModel
  )}:generateContent?key=${encodeURIComponent(ENV.geminiApiKey)}`;

  return { body, url };
}

function extractText(content: MessageContent | MessageContent[]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(extractText).join("\n");
  }
  if (content.type === "text") return content.text;
  if (content.type === "image_url") return `[image: ${content.image_url.url}]`;
  if (content.type === "file_url") return `[file: ${content.file_url.url}]`;
  return "";
}

/**
 * Gemini cevabını OpenAI formatına çevir (xfilter.router.ts bu formatı bekliyor).
 */
function geminiToOpenAIFormat(geminiResp: any): InvokeResult {
  const candidate = geminiResp?.candidates?.[0];
  const text =
    candidate?.content?.parts?.map((p: any) => p?.text || "").join("") || "";

  return {
    id: geminiResp?.responseId || `gemini-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: geminiResp?.modelVersion || ENV.geminiModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
        },
        finish_reason: candidate?.finishReason?.toLowerCase() || "stop",
      },
    ],
    usage: geminiResp?.usageMetadata
      ? {
          prompt_tokens: geminiResp.usageMetadata.promptTokenCount || 0,
          completion_tokens: geminiResp.usageMetadata.candidatesTokenCount || 0,
          total_tokens: geminiResp.usageMetadata.totalTokenCount || 0,
        }
      : undefined,
  };
}

/**
 * Ana giriş noktası. xfilter.router.ts bu fonksiyonu çağırır.
 */
export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  if (!ENV.geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Get one from https://aistudio.google.com/app/apikey"
    );
  }

  const { body, url } = buildGeminiPayload(params);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Gemini API network error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "<no body>");
    // 429 = rate limited, 403 = quota exhausted veya invalid key
    throw new Error(
      `Gemini API error ${response.status}: ${response.statusText} – ${errorText}`
    );
  }

  const json = await response.json();
  return geminiToOpenAIFormat(json);
}

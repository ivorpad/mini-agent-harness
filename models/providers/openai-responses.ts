import { isMessage, type Message, type ToolCall } from "../../agent/messages.ts";
import type { AssistantMessage, ModelProvider } from "../providers.ts";

interface ResponseOutput {
  type: string;
  content?: { type: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

interface ResponseEvent {
  type: string;
  delta?: string;
  output_index?: number;
  item?: ResponseOutput;
  response?: { status: string; output: ResponseOutput[] };
}

function convertMessages(messages: Message[]) {
  return messages.flatMap(message => {
    if (message.role === "tool") {
      return [{ type: "function_call_output", call_id: message.toolCallId, output: message.content }];
    }
    const items: Record<string, unknown>[] = [];
    if (message.content) items.push({ role: message.role, content: message.content });
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
      }
    }
    return items;
  });
}

function completedMessage(output: ResponseOutput[]): AssistantMessage {
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (const item of output) {
    if (item.type === "message") {
      content += (item.content ?? []).filter(block => block.type === "output_text")
        .map(block => block.text ?? "").join("");
    } else if (item.type === "function_call") {
      if (!item.call_id || !item.name || !item.arguments) throw new Error("Incomplete tool request");
      toolCalls.push({ id: item.call_id, name: item.name, arguments: JSON.parse(item.arguments) });
    }
  }
  const message: AssistantMessage = { role: "assistant", content };
  if (toolCalls.length) message.toolCalls = toolCalls;
  if (!isMessage(message)) throw new Error("Invalid model message");
  if (!content && !toolCalls.length) throw new Error("Model returned no text or tool requests");
  return message;
}

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<ResponseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done && buffer.trim()) buffer += "\n\n";
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trim())
          .join("\n").trim();
        if (data && data !== "[DONE]") yield JSON.parse(data);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readResponseStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta?: (text: string) => void,
): Promise<AssistantMessage> {
  const completedItems = new Map<number, ResponseOutput>();
  for await (const event of parseSSE(body)) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      onTextDelta?.(event.delta);
    }
    if (event.type === "response.output_item.done" && event.item && typeof event.output_index === "number") {
      completedItems.set(event.output_index, event.item);
    }
    if (event.type === "response.completed" || event.type === "response.done") {
      if (event.response?.status !== "completed") throw new Error("Model response did not complete");
      const output = completedItems.size
        ? [...completedItems].sort(([left], [right]) => left - right).map(([, item]) => item)
        : event.response.output;
      return completedMessage(output);
    }
    if (["error", "response.failed", "response.incomplete"].includes(event.type)) {
      throw new Error(`Model stream failed: ${event.type}`);
    }
  }
  throw new Error("Model stream ended without a completed response");
}

export function createOpenAIProvider(id: "openai" | "openai-codex"): ModelProvider {
  return {
    id,
    async complete(model, messages, credential, options) {
      const expectedApi = id === "openai" ? "openai-responses" : "openai-codex-responses";
      if (model.api !== expectedApi) throw new Error(`Unsupported API: ${model.api}`);
      if (credential.type === "oauth" && Date.now() >= credential.expires) {
        throw new Error(`Saved ${id} login expired. Refresh it in Pi before requesting a model.`);
      }
      const token = credential.type === "oauth" ? credential.access : credential.key;
      if (!token) throw new Error(`Missing ${id} access token or API key`);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      if (options.sessionId) headers["x-client-request-id"] = options.sessionId;
      if (id === "openai-codex") {
        const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
        const accountId = payload["https://api.openai.com/auth"]?.chatgpt_account_id;
        if (typeof accountId !== "string") throw new Error("Codex login has no account ID");
        headers["chatgpt-account-id"] = accountId;
        headers["OpenAI-Beta"] = "responses=experimental";
        if (options.sessionId) headers["session-id"] = options.sessionId;
      }
      const baseUrl = model.baseUrl.replace(/\/$/, "");
      const url = id === "openai-codex" ? `${baseUrl}/codex/responses` : `${baseUrl}/responses`;
      const level = options.thinkingLevel ?? "off";
      const mappedEffort = model.thinkingLevelMap?.[level];
      const effort = mappedEffort === undefined ? (level === "off" ? "none" : level) : mappedEffort;
      const response = await fetch(url, {
        method: "POST",
        headers,
        signal: options.signal ?? AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: model.modelName,
          input: convertMessages(messages),
          tools: options.tools?.map(tool => ({
            type: "function", name: tool.name, description: tool.description,
            parameters: tool.parameters, strict: false,
          })),
          instructions: options.systemPrompt || (id === "openai-codex" ? "You are a helpful assistant." : undefined),
          reasoning: effort === null ? undefined : { effort },
          store: false,
          stream: true,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        const detail = body?.error?.message?.replaceAll(token, "[redacted]") ?? "No error detail";
        throw new Error(`${id} Responses request failed (HTTP ${response.status}): ${detail}`);
      }
      if (!response.body) throw new Error("Model response has no stream");
      return readResponseStream(response.body, options.onTextDelta);
    },
  };
}

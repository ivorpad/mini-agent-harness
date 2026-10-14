import type { Credential, ModelDefinition } from "./model-runtime.ts";
import type { Message, ToolCall } from "../agent/messages.ts";
import type { ThinkingLevel } from "../agent/types.ts";
import { createOpenAIProvider } from "./providers/openai-responses.ts";
import type { ToolDefinition } from "../tools/tool.ts";

export type AssistantMessage = Extract<Message, { role: "assistant" }>;

export type ToolCallStreamEvent =
  | { type: "toolcall_start"; toolCallId: string; toolName: string; argumentsText: string }
  | { type: "toolcall_delta"; toolCallId: string; toolName: string; delta: string; argumentsText: string }
  | { type: "toolcall_end"; toolCall: ToolCall };

export interface RequestOptions {
  systemPrompt?: string;
  thinkingLevel?: ThinkingLevel;
  sessionId?: string;
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void;
  onToolCallEvent?: (event: ToolCallStreamEvent) => void;
  tools?: ToolDefinition[];
}

export interface ModelProvider {
  id: string;
  complete(
    model: ModelDefinition,
    messages: Message[],
    credential: Credential,
    options: RequestOptions,
  ): Promise<AssistantMessage>;
}

export function createProviders(): ModelProvider[] {
  return [createOpenAIProvider("openai"), createOpenAIProvider("openai-codex")];
}

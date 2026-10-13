import type { Credential, ModelDefinition } from "./model-runtime.ts";
import type { Message } from "../agent/messages.ts";
import type { ThinkingLevel } from "../agent/types.ts";
import { createOpenAIProvider } from "./providers/openai-responses.ts";
import type { ToolDefinition } from "../tools/tool.ts";

export type AssistantMessage = Extract<Message, { role: "assistant" }>;

export interface RequestOptions {
  systemPrompt?: string;
  thinkingLevel?: ThinkingLevel;
  sessionId?: string;
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void;
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

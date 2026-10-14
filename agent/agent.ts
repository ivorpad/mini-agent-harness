import type { ModelDefinition, ModelRuntime } from "../models/model-runtime.ts";
import type { Message } from "./messages.ts";
import type { AssistantMessage, ToolCallStreamEvent } from "../models/providers.ts";
import type { QueueMode, ThinkingBudgets, ThinkingLevel } from "./types.ts";
import type { Tool } from "../tools/tool.ts";

export interface AgentState {
  systemPrompt: string;
  messages: Message[];
  model: ModelDefinition;
  thinkingLevel: ThinkingLevel;
}

export interface AgentOptions {
  initialState: AgentState;
  modelRuntime: ModelRuntime;
  sessionId: string;
  blockImages: boolean;
  steeringMode: QueueMode;
  followUpMode: QueueMode;
  thinkingBudgets?: ThinkingBudgets;
  maxRetryDelayMs?: number;
  tools?: Tool[];
}

export class Agent {
  readonly state: AgentState;
  readonly options: AgentOptions;

  constructor(options: AgentOptions) {
    this.state = options.initialState;
    this.options = options;
  }

  async request(
    onTextDelta?: (text: string) => void,
    onToolCallEvent?: (event: ToolCallStreamEvent) => void,
    messages = this.state.messages,
  ): Promise<AssistantMessage> {
    return this.options.modelRuntime.complete(this.state.model, messages, {
      systemPrompt: this.state.systemPrompt,
      thinkingLevel: this.state.thinkingLevel,
      sessionId: this.options.sessionId,
      onTextDelta,
      onToolCallEvent,
      tools: this.options.tools?.map(({ name, description, parameters }) => ({ name, description, parameters })),
    });
  }
}

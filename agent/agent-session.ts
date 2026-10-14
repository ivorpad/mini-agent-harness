import type { ModelDefinition, ModelRuntime } from "../models/model-runtime.ts";
import { Agent } from "./agent.ts";
import { SessionManager } from "./session-manager.ts";
import type { Message } from "./messages.ts";
import type { AssistantMessage, ToolCallStreamEvent } from "../models/providers.ts";
import type { QueueMode, ThinkingBudgets, ThinkingLevel } from "./types.ts";
import { BashTool, type BashToolOptions } from "../tools/bash-tool.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { RequestContext } from "./request-context.ts";
import { extractToolOutputExcerpts, type ToolExcerpt } from "./tool-output-excerpts.ts";

export interface CreateAgentSessionOptions {
  cwd: string;
  modelRuntime: ModelRuntime;
  model: ModelDefinition;
  systemPrompt?: string;
  thinkingLevel?: ThinkingLevel;
  sessionManager?: SessionManager;
  sessionFile?: string;
  blockImages?: boolean;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  thinkingBudgets?: ThinkingBudgets;
  maxRetryDelayMs?: number;
  bash?: Omit<BashToolOptions, "root"> & { root?: string };
}

export type SessionEvent =
  | ToolCallStreamEvent
  | { type: "agent_start" }
  | { type: "message_end"; message: Message }
  | { type: "text_delta"; text: string }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; content: string; isError: boolean }
  | { type: "agent_end" };

export class AgentSession {
  readonly agent: Agent;
  readonly sessionManager: SessionManager;
  readonly context = new RequestContext();
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private running = false;

  constructor(agent: Agent, sessionManager: SessionManager) {
    this.agent = agent;
    this.sessionManager = sessionManager;
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async extractToolResults(
    indices: number[],
    options: { signal?: AbortSignal; task?: string; onProgress?: (completed: number, total: number) => void } = {},
  ): Promise<ToolExcerpt[]> {
    if (this.running) throw new Error("Wait for the current request to finish");
    this.running = true;
    try {
      return await extractToolOutputExcerpts(this.agent.options.modelRuntime, this.agent.state.model,
        this.sessionManager.getMessages(), indices, options);
    } finally {
      this.running = false;
    }
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async append(message: Message): Promise<void> {
    await this.sessionManager.append(message);
    this.agent.state.messages = this.sessionManager.getMessages();
    this.emit({ type: "message_end", message: structuredClone(message) });
  }

  async prompt(content: string): Promise<AssistantMessage> {
    if (this.running) throw new Error("A prompt is already running");
    this.running = true;
    try {
      this.emit({ type: "agent_start" });
      await this.append({ role: "user", content });
      while (true) {
        const reply = await this.agent.request(
          text => this.emit({ type: "text_delta", text }),
          event => this.emit(event),
          this.context.project(this.agent.state.messages),
        );
        await this.append(reply);
        if (!reply.toolCalls?.length) return reply;
        for (const call of reply.toolCalls) {
          this.emit({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name });
          let content: string;
          let isError = false;
          try {
            const tool = this.agent.options.tools?.find(tool => tool.name === call.name);
            if (!tool) throw new Error(`Unknown tool: ${call.name}`);
            content = await tool.execute(call.arguments);
          } catch (error) {
            isError = true;
            content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
          }
          await this.append({ role: "tool", toolCallId: call.id, content });
          this.emit({ type: "tool_execution_end", toolCallId: call.id, toolName: call.name, content, isError });
        }
      }
    } finally {
      this.running = false;
      this.emit({ type: "agent_end" });
    }
  }
}

export async function createAgentSession(
  options: CreateAgentSessionOptions,
): Promise<{ session: AgentSession }> {
  const bashOptions = { ...options.bash, root: options.bash?.root ?? options.cwd };
  const systemPrompt = options.systemPrompt ?? await buildSystemPrompt(bashOptions);
  const sessionManager = options.sessionManager
    ?? (options.sessionFile
      ? await SessionManager.open(options.cwd, options.sessionFile)
      : await SessionManager.create(options.cwd));

  const agent = new Agent({
    initialState: {
      systemPrompt,
      messages: sessionManager.getMessages(),
      model: options.model,
      thinkingLevel: options.thinkingLevel ?? "off",
    },
    modelRuntime: options.modelRuntime,
    sessionId: sessionManager.id,
    blockImages: options.blockImages ?? false,
    steeringMode: options.steeringMode ?? "one-at-a-time",
    followUpMode: options.followUpMode ?? "one-at-a-time",
    thinkingBudgets: options.thinkingBudgets,
    maxRetryDelayMs: options.maxRetryDelayMs,
    tools: [new BashTool(bashOptions)],
  });

  const session = new AgentSession(agent, sessionManager);
  return { session };
}

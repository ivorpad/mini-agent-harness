import type { JsonValue } from "../agent/messages.ts";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, JsonValue>;
}

export interface Tool extends ToolDefinition {
  execute(arguments_: Record<string, JsonValue>): Promise<string>;
}

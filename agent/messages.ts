export type JsonValue = null | boolean | number | string | JsonValue[]
  | { [key: string]: JsonValue };

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, JsonValue>;
}

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (typeof message.content !== "string") return false;
  switch (message.role) {
    case "system":
    case "user":
      return true;
    case "assistant":
      return message.toolCalls === undefined
        || (Array.isArray(message.toolCalls) && message.toolCalls.every(isToolCall));
    case "tool":
      return typeof message.toolCallId === "string" && message.toolCallId.length > 0;
    default:
      return false;
  }
}

function isToolCall(value: unknown): value is ToolCall {
  if (typeof value !== "object" || value === null) return false;
  const call = value as Record<string, unknown>;
  return typeof call.id === "string" && call.id.length > 0
    && typeof call.name === "string" && call.name.length > 0
    && typeof call.arguments === "object" && call.arguments !== null
    && !Array.isArray(call.arguments) && isJsonValue(call.arguments);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every(isJsonValue);
}

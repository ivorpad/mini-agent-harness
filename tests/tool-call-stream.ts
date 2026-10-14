import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createAgentSession, type SessionEvent } from "../agent/agent-session.ts";
import { SessionManager } from "../agent/session-manager.ts";
import { ModelRuntime, createModels } from "../models/model-runtime.ts";
import { createOpenAIProvider } from "../models/providers/openai-responses.ts";
import type { ToolCallStreamEvent } from "../models/providers.ts";

function response(events: unknown[]): Response {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
  return new Response(new ReadableStream({
    start(controller) {
      // Split both JSON and UTF-8 characters across network chunks.
      for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
      controller.close();
    },
  }));
}

const originalFetch = globalThis.fetch;
const model = createModels()["openai/gpt-6.1-sol"]!;
const provider = createOpenAIProvider("openai");
const first = { type: "function_call", call_id: "first", name: "bash", arguments: '{"command":"printf á"}' };
const second = { type: "function_call", call_id: "second", name: "bash", arguments: '{"command":"printf 43"}' };
const events: SessionEvent[] = [];
let requests = 0;
try {
  globalThis.fetch = (async () => {
    if (requests++ > 0) return response([
      { type: "response.output_text.delta", delta: "Finished" },
      { type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Finished" }] }] } },
    ]);
    return response([
      { type: "response.output_item.added", output_index: 0, item: { ...first, arguments: "" } },
      { type: "response.output_item.added", output_index: 1, item: { ...second, arguments: "" } },
      { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"command":"printf ' },
      { type: "response.function_call_arguments.delta", output_index: 1, delta: second.arguments },
      // The done event can supply a suffix not present in preceding deltas.
      { type: "response.function_call_arguments.done", output_index: 0, arguments: first.arguments },
      { type: "response.output_item.done", output_index: 1, item: second },
      { type: "response.output_item.done", output_index: 0, item: first },
      { type: "response.completed", response: { status: "completed", output: [first, second] } },
    ]);
  }) as unknown as typeof fetch;
  const cwd = await mkdtemp("/private/tmp/tool-call-stream-");
  const runtime = new ModelRuntime({ openai: { type: "api_key", key: "fixture" } }, [provider]);
  const { session } = await createAgentSession({ cwd, modelRuntime: runtime, model });
  session.subscribe(event => {
    events.push(event);
    if (event.type.startsWith("toolcall_")) {
      assert.equal(session.sessionManager.getMessages().length, 1, "Partial calls must not be persisted or executed");
    }
  });
  assert.equal((await session.prompt("fixture")).content, "Finished");
  const calls = events.filter((event): event is ToolCallStreamEvent => event.type.startsWith("toolcall_"));
  assert.equal(calls.filter(event => event.type === "toolcall_start").length, 2);
  assert.equal(calls.filter(event => event.type === "toolcall_end").length, 2, "Terminal response must not duplicate call completion");
  for (const item of [first, second]) {
    const text = calls.filter(event => event.type === "toolcall_delta" && event.toolCallId === item.call_id)
      .map(event => event.type === "toolcall_delta" ? event.delta : "").join("");
    assert.equal(text, item.arguments);
  }
  const endIndex = events.findLastIndex(event => event.type === "toolcall_end");
  assert(events.findIndex(event => event.type === "tool_execution_start") > endIndex);
  const history = session.sessionManager.getMessages();
  assert.deepEqual(history.map(message => message.role), ["user", "assistant", "tool", "tool", "assistant"]);
  assert.equal(history[2]?.role === "tool" && history[2].toolCallId, "first", "Execution retains model output order");
  assert.match(history[2]!.content, /á/);
  assert.deepEqual((await SessionManager.open(cwd, session.sessionManager.sessionFile)).getMessages(), history);

  const fallback: ToolCallStreamEvent[] = [];
  globalThis.fetch = (async () => response([
    { type: "response.completed", response: { status: "completed", output: [first] } },
  ])) as unknown as typeof fetch;
  await provider.complete(model, [], { type: "api_key", key: "fixture" }, { onToolCallEvent: event => fallback.push(event) });
  assert.deepEqual(fallback.map(event => event.type), ["toolcall_start", "toolcall_end"]);

  globalThis.fetch = (async () => response([
    { type: "response.output_item.done", output_index: 0, item: { ...first, arguments: "{" } },
  ])) as unknown as typeof fetch;
  await assert.rejects(() => provider.complete(model, [], { type: "api_key", key: "fixture" }, {}), SyntaxError);
  console.log("Passed: interleaved tool deltas, completion suffix, UTF-8 chunks, no duplicate events, execution order, persistence, terminal fallback and invalid arguments");
} finally {
  globalThis.fetch = originalFetch;
}

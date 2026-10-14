import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createAgentSession } from "../agent/agent-session.ts";
import { SessionManager } from "../agent/session-manager.ts";
import { ModelRuntime, createModels } from "../models/model-runtime.ts";
import type { Message } from "../agent/messages.ts";

let extractionRequests = 0;
let sent: Message[] = [];
const seenOutput = new Map<number, string>();
const runtime = new ModelRuntime({ fixture: { type: "api_key", key: "fixture" } }, [{
  id: "fixture", async complete(_model, messages, _credential, options) {
    if (options.systemPrompt?.startsWith("Extract compact")) {
      extractionRequests++;
      assert.equal(options.tools, undefined, "Extraction must not have tools");
      const { results } = JSON.parse(messages[0]!.content);
      return { role: "assistant", content: JSON.stringify(results.map((piece: { index: number; part: number; output: string }) => {
        seenOutput.set(piece.index, (seenOutput.get(piece.index) ?? "") + piece.output);
        return { index: piece.index, part: piece.part, text: `Important result ${piece.index}, part ${piece.part}` };
      })) };
    }
    sent = messages;
    return { role: "assistant", content: "done" };
  },
}]);
const cwd = await mkdtemp("/private/tmp/request-context-");
const model = { ...createModels()["openai/gpt-6.1-sol"]!, provider: "fixture" };
const { session } = await createAgentSession({ cwd, modelRuntime: runtime, model });
await session.sessionManager.append({ role: "user", content: "old request" });
await session.sessionManager.append({ role: "assistant", content: "", toolCalls: Array.from({ length: 50 }, (_, index) => ({ id: `call${index}`, name: "bash", arguments: { command: "fixture" } })) });
for (let index = 0; index < 50; index++) {
  await session.sessionManager.append({ role: "tool", toolCallId: `call${index}`, content: index === 0 ? "🙂".repeat(7000) : `Full output ${index}` });
}
const history = session.sessionManager.getMessages();
session.agent.state.messages = history;
session.context.setUserIncluded(history, 0, false);
const drafts = await session.extractToolResults(Array.from({ length: 50 }, (_, index) => index + 2));
assert.equal(drafts.length, 50);
assert(extractionRequests <= 4, "Fifty small outputs should be batched, not require fifty requests");
assert.equal(session.context.toolExcerpt(2), undefined, "Extraction must await review before applying");
for (const [index, output] of seenOutput) assert.equal(output, history[index]!.content, "No output may be silently truncated");
session.context.setToolExcerpt(history, 3, drafts.find(draft => draft.index === 3)!.text);
await session.prompt("next request");
assert(!sent.some(message => message.content === "old request"));
assert(sent.some(message => message.role === "tool" && message.toolCallId === "call1" && message.content.includes("Important result 3")));
assert(sent.some(message => message.content === "next request"));
assert.equal(session.sessionManager.getMessages()[3]!.content, "Full output 1");
assert.deepEqual((await SessionManager.open(cwd, session.sessionManager.sessionFile)).getMessages().slice(0, history.length), history);
session.context.reset();
assert.deepEqual(session.context.project(history), history);
assert.throws(() => session.context.setToolExcerpt(history, 0, "bad"));
assert.throws(() => session.context.setUserIncluded(history, 2, false));
console.log("Passed: 50 outputs batched, full Unicode input retained, drafts await review, request-only omissions and excerpts, tool IDs preserved, saved history unchanged and restore works");

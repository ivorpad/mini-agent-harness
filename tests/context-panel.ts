import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createTestRenderer } from "@opentui/core/testing";
import { createAgentSession } from "../agent/agent-session.ts";
import { ModelRuntime, createModels } from "../models/model-runtime.ts";
import { ContextPanel } from "../ui/context-panel.ts";

const runtime = new ModelRuntime({ fixture: { type: "api_key", key: "fixture" } }, [{
  id: "fixture", async complete(_model, messages) {
    const { results } = JSON.parse(messages[0]!.content);
    return { role: "assistant", content: JSON.stringify(results.map((piece: { index: number; part: number }) => ({ ...piece, text: "Important checkpoint 42" }))) };
  },
}]);
const cwd = await mkdtemp("/private/tmp/context-panel-");
const { session } = await createAgentSession({ cwd, modelRuntime: runtime, model: { ...createModels()["openai/gpt-6.1-sol"]!, provider: "fixture" } });
for (const message of [
  { role: "user" as const, content: "Old request" },
  { role: "assistant" as const, content: "", toolCalls: [{ id: "one", name: "bash", arguments: { command: "fixture" } }] },
  { role: "tool" as const, toolCallId: "one", content: "Long output ".repeat(70) },
  { role: "user" as const, content: "Another request" },
]) await session.sessionManager.append(message);
const test = await createTestRenderer({ width: 110, height: 35 });
let closed = false;
try {
  const panel = new ContextPanel(test.renderer, session, () => {}, () => { closed = true; });
  test.renderer.root.add(panel);
  await test.renderOnce();
  async function click(label: string): Promise<void> {
    const lines = test.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes(label));
    assert(y >= 0, `Visible action missing: ${label}`);
    const x = lines[y]!.indexOf(label) + 1;
    await test.mockMouse.click(x, y);
    await test.renderOnce();
  }
  await click("#0 User");
  assert.equal(session.context.includesUser(0), false);
  assert.match(test.captureCharFrame(), /Omitted/);
  await click("#3 User");
  assert.equal(session.context.includesUser(3), false);
  await click("#3 User");
  assert.equal(session.context.includesUser(3), true);
  await click("Extract selected (1)");
  await test.waitForFrame(frame => frame.includes("drafts ready"));
  assert.equal(session.context.toolExcerpt(2), undefined);
  assert.match(test.captureCharFrame(), /Important checkpoint 42/);
  await click("Edit excerpt");
  assert.match(test.captureCharFrame(), /Saving creates a draft/);
  await click("Cancel edit");
  await click("Apply all drafts (1)");
  assert.equal(session.context.toolExcerpt(2), "Important checkpoint 42");
  await click("Use full output");
  assert.equal(session.context.toolExcerpt(2), undefined);
  await click("Restore all");
  assert.equal(session.context.includesUser(0), true);
  await click("Done");
  assert(closed);
  console.log("Passed: native mouse toggles indices 0 and 3, extraction drafts require apply, editor opens, full output restores, restore-all and close work");
} finally {
  await test.dispose();
}

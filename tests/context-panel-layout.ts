import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createTestRenderer } from "@opentui/core/testing";
import { createAgentSession } from "../agent/agent-session.ts";
import { ModelRuntime, createModels } from "../models/model-runtime.ts";
import { ContextPanel } from "../ui/context-panel.ts";

const runtime = new ModelRuntime({ fixture: { type: "api_key", key: "fixture" } }, [{
  id: "fixture", async complete() { return { role: "assistant", content: "fixture" }; },
}]);
const cwd = await mkdtemp("/private/tmp/context-layout-");
const { session } = await createAgentSession({ cwd, modelRuntime: runtime,
  model: { ...createModels()["openai/gpt-6.1-sol"]!, provider: "fixture" } });
for (let index = 0; index < 12; index++) {
  await session.sessionManager.append({ role: "user", content: `Request ${index}: ${"long text ".repeat(30)}` });
  await session.sessionManager.append({ role: "assistant", content: "", toolCalls: [
    { id: `call${index}`, name: "bash", arguments: { command: "read file" } },
  ] });
  await session.sessionManager.append({ role: "tool", toolCallId: `call${index}`,
    content: JSON.stringify({ stdout: "source code line\n".repeat(400), stderr: "", exitCode: 0 }) });
}
for (const [width, height] of [[110, 35], [90, 18], [64, 24]]) {
  const test = await createTestRenderer({ width, height });
  try {
    const panel = new ContextPanel(test.renderer, session, () => {}, () => {});
    test.renderer.root.add(panel);
    await test.renderOnce();
    const lines = test.captureCharFrame().split("\n");
    if (process.env.SHOW_FRAME) console.log(lines.join("\n"));
    const summary = lines.findIndex(line => line.includes("36/36 messages"));
    const subtitle = lines.findIndex(line => line.includes("Saved history"));
    const status = lines.findIndex(line => line.includes("Long outputs"));
    const apply = lines.findIndex(line => line.includes("Apply all drafts"));
    assert(summary > subtitle, `${width}x${height}: summary overlaps subtitle`);
    assert(status > summary, `${width}x${height}: status overlaps summary`);
    assert(apply > status, `${width}x${height}: footer must remain visible`);
    assert(!lines[apply]!.includes("source code"), "Tool output must not overlap footer actions");
    const list = panel.getChildren().find(child => child.constructor.name === "ScrollBoxRenderable")!;
    assert(list.y > status, "List must start below status");
    assert(list.y + list.height <= apply, "List must end above footer");
    for (const row of list.getChildren()) assert(row.height > 0, "Scrollable rows must retain their height");
  } finally { await test.dispose(); }
}
console.log("Passed: crowded context panel keeps headers, scroll rows and footer separate at three terminal sizes");

import assert from "node:assert/strict";
import { createTestRenderer } from "@opentui/core/testing";
import { ToolCallView } from "../ui/tool-call-view.ts";

const test = await createTestRenderer({ width: 90, height: 35 });
try {
  const row = new ToolCallView(test.renderer, "bash", "seq 1 12");
  test.renderer.root.add(row);
  const output = Array.from({ length: 12 }, (_, index) => `Output line ${index + 1}`).join("\n");
  row.finish(JSON.stringify({ stdout: output, stderr: "", exitCode: 0 }), false);
  await test.renderOnce();
  let frame = test.captureCharFrame();
  assert.match(frame, /completed · exit 0/);
  assert.match(frame, /click to expand/);
  assert.match(frame, /Output line 3/);
  assert.doesNotMatch(frame, /Output line 12/);

  async function clickToggle(label: string): Promise<void> {
    const y = test.captureCharFrame().split("\n").findIndex(line => line.includes(label));
    assert(y >= 0, "Toggle must be visible");
    await test.mockMouse.click(5, y);
    await test.renderOnce();
  }
  await clickToggle("Show full output");
  frame = test.captureCharFrame();
  assert.match(frame, /Output line 12/);
  assert.match(frame, /Collapse output/);
  await clickToggle("Collapse output");
  assert.doesNotMatch(test.captureCharFrame(), /Output line 12/);

  row.finish(JSON.stringify({ stdout: "short output", stderr: "", exitCode: 0 }), false);
  await test.renderOnce();
  assert.match(test.captureCharFrame(), /short output/);
  assert.doesNotMatch(test.captureCharFrame(), /Show full output/);

  row.finish(JSON.stringify({ stdout: "x".repeat(500) + "END_MARKER", stderr: "", exitCode: 1 }), false);
  await test.renderOnce();
  assert.match(test.captureCharFrame(), /failed · exit 1/);
  assert.doesNotMatch(test.captureCharFrame(), /END_MARKER/);
  await clickToggle("Show full output");
  assert.match(test.captureCharFrame(), /END_MARKER/);
  console.log("Passed: mouse expands and collapses full output, short output stays visible, long single lines fold, failure status stays visible");
} finally {
  await test.dispose();
}

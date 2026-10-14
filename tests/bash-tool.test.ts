import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { BashTool } from "../tools/bash-tool.ts";
import { buildSystemPrompt } from "../agent/system-prompt.ts";

const root = await mkdtemp("/private/tmp/host-bash-");
const bash = new BashTool({ root });
const run = async (command: string, timeout?: number) => JSON.parse(await bash.execute({ command, ...(timeout ? { timeout } : {}) }));

test("host commands execute with real paths, pipes, stderr and exit codes", async () => {
  const result = await run("pwd && printf hello | tr a-z A-Z; printf problem >&2; exit 7");
  expect(result.stdout).toBe(`${root}\nHELLO`);
  expect(result.stderr).toBe("problem");
  expect(result.exitCode).toBe(7);
});

test("bash launches the installed Bun test runner and standalone scripts", async () => {
  await writeFile(`${root}/fixture.test.ts`, 'import { test, expect } from "bun:test"; test("fixture", () => expect(2 + 2).toBe(4));');
  await writeFile(`${root}/fixture.ts`, 'console.log("script ran");');
  const result = await run("bun test fixture.test.ts && bun run fixture.ts");
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("1 pass");
  expect(result.stdout).toContain("script ran");
});

test("files persist but shell state resets", async () => {
  expect((await run("export FIXTURE_VAR=old; printf saved > result.txt")).exitCode).toBe(0);
  expect(await readFile(`${root}/result.txt`, "utf8")).toBe("saved");
  expect((await run('printf "%s" "${FIXTURE_VAR-unset}"')).stdout).toBe("unset");
});

test("timeout kills shell children before they write", async () => {
  const result = await run("(sleep 0.3; touch late.txt) & wait", 0.05);
  expect(result.exitCode).toBe(124);
  expect(result.stderr).toContain("timed out");
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(await Bun.file(`${root}/late.txt`).exists()).toBe(false);
});

test("system prompt describes host execution", async () => {
  const prompt = await buildSystemPrompt({ root });
  expect(prompt).toContain("real host /bin/bash");
  expect(prompt).toContain(root);
  expect(prompt).not.toContain("virtual paths");
  expect(prompt).not.toContain("just-bash");
});

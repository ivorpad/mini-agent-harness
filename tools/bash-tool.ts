import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { JsonValue } from "../agent/messages.ts";
import type { Tool } from "./tool.ts";

export interface BashToolOptions {
  root: string;
  env?: Record<string, string>;
  exec?: { cwd?: string; env?: Record<string, string>; stdin?: string; replaceEnv?: boolean };
  timeoutSeconds?: number;
}

export class BashTool implements Tool {
  readonly name = "bash";
  readonly description = "Run commands in a real host bash shell, starting in the workspace directory. Installed programs and network access are available subject to host permissions. Use real filesystem paths. Filesystem changes persist, but shell state resets between executions. Returns JSON containing stdout, stderr and exitCode; inspect all three before deciding whether a command succeeded.";
  readonly parameters = {
    type: "object",
    properties: {
      command: { type: "string", description: "Host bash command, for example bun test or bunx tsc --noEmit" },
      timeout: { type: "number", exclusiveMinimum: 0, description: "Positive timeout in seconds, capped by the configured tool limit" },
    },
    required: ["command"],
    additionalProperties: false,
  };
  private readonly options: BashToolOptions;

  constructor(options: BashToolOptions) {
    this.options = options;
  }

  async execute(arguments_: Record<string, JsonValue>): Promise<string> {
    if (typeof arguments_.command !== "string") throw new Error("Bash requires a command string");
    const limit = this.options.timeoutSeconds ?? 30;
    const timeout = arguments_.timeout ?? limit;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0
      || !Number.isFinite(limit) || limit <= 0) throw new Error("Invalid Bash timeout");
    const command = arguments_.command;
    const root = resolve(this.options.root);
    const exec = this.options.exec;
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(resolveResult => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const child = spawn("/bin/bash", ["-c", command], {
        cwd: resolve(root, exec?.cwd ?? "."),
        env: { ...(exec?.replaceEnv ? {} : process.env), ...this.options.env, ...exec?.env },
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      const timer = setTimeout(() => {
        timedOut = true;
        // Kill the entire shell job, including test runners and their children.
        if (child.pid) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }
      }, Math.ceil(Math.min(timeout, limit) * 1000));
      child.on("error", error => {
        clearTimeout(timer);
        resolveResult({ stdout, stderr: `${stderr}${error.message}\n`, exitCode: 1 });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (timedOut) stderr += "Command timed out.\n";
        else if (signal) stderr += `Command terminated by ${signal}.\n`;
        resolveResult({ stdout, stderr, exitCode: timedOut ? 124 : code ?? 1 });
      });
      // A command may exit without consuming its input.
      child.stdin.on("error", () => {});
      child.stdin.end(exec?.stdin ?? "");
    });
    return JSON.stringify(result);
  }
}

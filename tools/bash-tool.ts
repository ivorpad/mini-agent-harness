import { resolve } from "node:path";
import { Bash, ReadWriteFs, type BashOptions, type ExecOptions } from "just-bash";
import type { JsonValue } from "../agent/messages.ts";
import type { Tool } from "./tool.ts";

export interface BashToolOptions {
  root: string;
  env?: BashOptions["env"];
  executionLimits?: BashOptions["executionLimits"];
  exec?: Omit<ExecOptions, "signal">;
  timeoutSeconds?: number;
}

export class BashTool implements Tool {
  readonly name = "bash";
  readonly description = "Execute Bash commands in the configured workspace using just-bash.";
  readonly parameters = {
    type: "object",
    properties: {
      command: { type: "string", description: "Bash command to execute" },
      timeout: { type: "number", description: "Timeout in seconds" },
    },
    required: ["command"],
    additionalProperties: false,
  };
  private readonly bash: Bash;
  private readonly options: BashToolOptions;

  constructor(options: BashToolOptions) {
    this.options = options;
    this.bash = new Bash({
      fs: new ReadWriteFs({ root: resolve(options.root), allowSymlinks: false }),
      cwd: "/",
      env: options.env,
      executionLimits: options.executionLimits,
    });
  }

  async execute(arguments_: Record<string, JsonValue>): Promise<string> {
    if (typeof arguments_.command !== "string") throw new Error("Bash requires a command string");
    const limit = this.options.timeoutSeconds ?? 30;
    const timeout = arguments_.timeout ?? limit;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0
      || !Number.isFinite(limit) || limit <= 0) throw new Error("Invalid Bash timeout");
    const result = await this.bash.exec(arguments_.command, {
      ...this.options.exec,
      signal: AbortSignal.timeout(Math.ceil(Math.min(timeout, limit) * 1000)),
    });
    return JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
  }
}

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isMessage, type Message } from "./messages.ts";

export class SessionManager {
  private messages: Message[] = [];
  private pendingWrite: Promise<void> = Promise.resolve();
  readonly id: string;
  readonly cwd: string;
  readonly sessionFile: string;

  private constructor(id: string, cwd: string, sessionFile: string) {
    this.id = id;
    this.cwd = cwd;
    this.sessionFile = sessionFile;
  }

  static async create(cwd: string): Promise<SessionManager> {
    const directory = resolve(cwd);
    const id = randomUUID(); // New session, new UUID.
    const sessionsDirectory = join(directory, ".sessions");
    const sessionFile = join(sessionsDirectory, `${id}.jsonl`);
    await mkdir(sessionsDirectory, { recursive: true });
    const header = { type: "session", version: 1, id, cwd: directory };
    await writeFile(sessionFile, JSON.stringify(header) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return new SessionManager(id, directory, sessionFile);
  }

  static async open(cwd: string, sessionFile: string): Promise<SessionManager> {
    const file = resolve(cwd, sessionFile);
    const source = await readFile(file, "utf8");
    const lines = source.trimEnd().split("\n");
    const header: unknown = JSON.parse(lines[0]!);
    if (typeof header !== "object" || header === null
      || !("type" in header) || header.type !== "session"
      || !("version" in header) || header.version !== 1
      || !("id" in header) || typeof header.id !== "string"
      || !("cwd" in header) || typeof header.cwd !== "string") {
      throw new Error(`Invalid session header: ${file}`);
    }
    const manager = new SessionManager(header.id, header.cwd, file);
    for (const line of lines.slice(1)) {
      const entry: unknown = JSON.parse(line);
      if (typeof entry !== "object" || entry === null
        || !("type" in entry) || entry.type !== "message"
        || !("message" in entry) || !isMessage(entry.message)) {
        throw new Error(`Invalid session message: ${file}`);
      }
      manager.messages.push(entry.message);
    }
    return manager;
  }

  getMessages(): Message[] {
    return structuredClone(this.messages);
  }

  append(message: Message): Promise<void> {
    if (!isMessage(message)) return Promise.reject(new Error("Invalid message"));
    const copy = structuredClone(message);
    const operation = this.pendingWrite.then(async () => {
      const entry = { type: "message", message: copy };
      await appendFile(this.sessionFile, JSON.stringify(entry) + "\n", "utf8");
      this.messages.push(copy);
    });
    this.pendingWrite = operation.catch(() => {});
    return operation;
  }
}

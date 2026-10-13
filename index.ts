import { ModelRuntime } from "./models/model-runtime.ts";
import { createAgentSession, type AgentSession } from "./agent/agent-session.ts";

export async function createSession(cwd = process.cwd()): Promise<AgentSession> {
  const modelRuntime = await ModelRuntime.create();
  const model = modelRuntime.getModel("openai", "gpt-6.1-sol");
  const { session } = await createAgentSession({
    cwd,
    modelRuntime,
    model,
    systemPrompt: "You are a helpful assistant.",
  });
  return session;
}

export async function main(input: string, session: AgentSession) {
  return session.prompt(input);
}

if (import.meta.main) {
  const session = await createSession();
  session.subscribe(event => {
    if (event.type === "text_delta") process.stdout.write(event.text);
  });
  try {
    await main(process.argv.slice(2).join(" "), session);
    process.stdout.write("\n");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

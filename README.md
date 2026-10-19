# mini-agent-harness

I'm building this to develop a strong mental model of how coding agents like Claude Code and Codex work. I want to understand the code around the model by writing my own harness, starting with the smallest loop: send messages, run the tools the model asks for, feed back the results, repeat.

From there, I'm adding things as I want to understand them: sessions, context management, steering, permissions. Pi is a reference to learn from. I use Tracelight to pause execution, inspect real values and try small experiments. I want to be able to follow a request through the code and explain what happened.

This is a learning project. The point is to understand the decisions and trade-offs as I build it. I use coding agents to help investigate and explain things, but I want to stay involved in the code and choose what to tackle next.

To install dependencies:

```bash
bun install
```

To run the minimal OpenTUI entry point, which calls `index.ts`:

```bash
bun run start
```

Type a message and press Enter. The TUI calls `main(input)` in `index.ts`, which only logs the input. Logs appear in the console. Press Ctrl+C to quit.

Use `bun run agent "hello"` to call `main` without OpenTUI. The harness will be built here incrementally.

# mini-agent-harness

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

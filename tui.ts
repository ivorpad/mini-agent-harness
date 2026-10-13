import {
  BoxRenderable, createCliRenderer, InputRenderable, InputRenderableEvents,
  ScrollBoxRenderable, TextRenderable,
} from "@opentui/core";
import { format } from "node:util";
import { createSession, main } from "./index.ts";

const session = await createSession();

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  backgroundColor: "#0a0a0a",
});
renderer.setTerminalTitle("MiniAgentHarness");
const layout = new BoxRenderable(renderer, {
  width: "100%", height: "100%", paddingX: 2, paddingTop: 1,
  flexDirection: "column", gap: 1,
});
const transcript = new ScrollBoxRenderable(renderer, {
  width: "100%", flexGrow: 1, minHeight: 0,
  scrollX: false, stickyScroll: true, stickyStart: "bottom",
  contentOptions: { gap: 1 },
});
layout.add(transcript);
const prompt = new BoxRenderable(renderer, {
  width: "100%", padding: 1, gap: 1, flexShrink: 0,
  backgroundColor: "#1e1e1e", border: ["left"], borderColor: "#6aa6e8",
});
const input = new InputRenderable(renderer, {
  id: "prompt",
  placeholder: "Send a message…",
  width: "100%",
  backgroundColor: "#1e1e1e", focusedBackgroundColor: "#1e1e1e",
  textColor: "#eeeeee", focusedTextColor: "#eeeeee",
});
prompt.add(input);
prompt.add(new TextRenderable(renderer, {
  content: "MiniAgentHarness", fg: "#6aa6e8",
}));
layout.add(prompt);
const footer = new BoxRenderable(renderer, {
  width: "100%", flexDirection: "row", justifyContent: "space-between", flexShrink: 0,
});
footer.add(new TextRenderable(renderer, {
  content: "index.ts", fg: "#777777",
}));
footer.add(new TextRenderable(renderer, {
  content: "Enter send  ·  Ctrl+C quit", fg: "#999999",
}));
layout.add(footer);
renderer.root.add(layout);

const originalLog = console.log;
console.log = (...args: unknown[]) => {
  transcript.add(new TextRenderable(renderer, {
    content: format(...args), fg: "#aaaaaa", paddingX: 2,
  }));
  originalLog(...args);
};
renderer.on("destroy", () => { console.log = originalLog; });
let busy = false;
let assistantText: TextRenderable | undefined;
let replyText = "";
const unsubscribe = session.subscribe(event => {
  if (event.type === "text_delta" && assistantText) {
    replyText += event.text;
    assistantText.content = replyText;
  }
  if (event.type === "message_end" && event.message.role === "assistant" && assistantText) {
    assistantText.content = event.message.content;
  }
});
renderer.on("destroy", unsubscribe);
input.on(InputRenderableEvents.ENTER, async (value: string) => {
  if (busy || !value.trim()) return;
  busy = true;
  const message = new BoxRenderable(renderer, {
    width: "100%", padding: 1, backgroundColor: "#141414",
    border: ["left"], borderColor: "#6aa6e8", flexShrink: 0,
  });
  message.add(new TextRenderable(renderer, { content: value, fg: "#eeeeee" }));
  transcript.add(message);
  input.value = "";
  replyText = "";
  assistantText = new TextRenderable(renderer, {
    content: "Thinking…", fg: "#aaaaaa", paddingX: 2,
  });
  transcript.add(assistantText);
  try {
    await main(value, session);
  } catch (error) {
    assistantText.content = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    busy = false;
  }
});
input.focus();

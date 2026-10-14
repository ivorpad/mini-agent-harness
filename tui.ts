import {
  BoxRenderable, createCliRenderer, InputRenderable, InputRenderableEvents,
  ScrollBoxRenderable, TextRenderable,
} from "@opentui/core";
import { format } from "node:util";
import { createSession, main } from "./index.ts";
import { ToolCallView } from "./ui/tool-call-view.ts";
import { ContextPanel } from "./ui/context-panel.ts";

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
const contextButton = new TextRenderable(renderer, {
  content: "Context · Ctrl+K", fg: "#6aa6e8", selectable: false,
  onMouseUp: event => { if (event.button === 0) { event.stopPropagation(); openContext(); } },
});
footer.add(contextButton);
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
const toolRows = new Map<string, ToolCallView>();
let contextPanel: ContextPanel | undefined;

function updateContextButton(): void {
  const messages = session.sessionManager.getMessages();
  const omitted = messages.filter((message, index) => message.role === "user" && !session.context.includesUser(index)).length;
  const excerpts = messages.filter((message, index) => message.role === "tool" && session.context.toolExcerpt(index) !== undefined).length;
  contextButton.content = `Context · ${omitted} omitted · ${excerpts} excerpts · Ctrl+K`;
}

function openContext(): void {
  if (busy || contextPanel) return;
  input.blur();
  contextPanel = new ContextPanel(renderer, session, updateContextButton, () => {
    contextPanel = undefined; updateContextButton(); input.focus();
  }, input.value);
  renderer.root.add(contextPanel);
}

renderer.keyInput.on("keypress", key => {
  if (key.ctrl && key.name === "k") {
    key.preventDefault();
    if (contextPanel) contextPanel.close(); else openContext();
  } else if (key.name === "escape" && contextPanel) {
    key.preventDefault(); contextPanel.close();
  }
});

function ensureAssistantText(): TextRenderable {
  if (!assistantText) {
    replyText = "";
    assistantText = new TextRenderable(renderer, {
      content: "", fg: "#aaaaaa", paddingX: 2,
    });
    transcript.add(assistantText);
  }
  return assistantText;
}

const unsubscribe = session.subscribe(event => {
  if (event.type === "text_delta") {
    const view = ensureAssistantText();
    replyText += event.text;
    view.content = replyText;
  }
  if (event.type === "toolcall_start") {
    if (assistantText && !replyText) assistantText.content = "";
    const view = new ToolCallView(renderer, event.toolName, event.argumentsText);
    toolRows.set(event.toolCallId, view);
    transcript.add(view);
  }
  if (event.type === "toolcall_delta") {
    toolRows.get(event.toolCallId)?.setDetails(event.argumentsText);
  }
  if (event.type === "toolcall_end") {
    const row = toolRows.get(event.toolCall.id);
    if (row) {
      row.setDetails(typeof event.toolCall.arguments.command === "string"
        ? event.toolCall.arguments.command : JSON.stringify(event.toolCall.arguments, null, 2));
      row.setStatus("ready");
    }
  }
  if (event.type === "tool_execution_start") {
    toolRows.get(event.toolCallId)?.setStatus("running");
  }
  if (event.type === "tool_execution_end") {
    toolRows.get(event.toolCallId)?.finish(event.content, event.isError);
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    if (event.message.content) ensureAssistantText().content = event.message.content;
    if (event.message.toolCalls?.length) assistantText = undefined;
  }
});
renderer.on("destroy", unsubscribe);
input.on(InputRenderableEvents.ENTER, async (value: string) => {
  if (busy || contextPanel || !value.trim()) return;
  busy = true;
  const message = new BoxRenderable(renderer, {
    width: "100%", padding: 1, backgroundColor: "#141414",
    border: ["left"], borderColor: "#6aa6e8", flexShrink: 0,
  });
  message.add(new TextRenderable(renderer, { content: value, fg: "#eeeeee" }));
  transcript.add(message);
  input.value = "";
  replyText = "";
  toolRows.clear();
  assistantText = new TextRenderable(renderer, {
    content: "Thinking…", fg: "#aaaaaa", paddingX: 2,
  });
  transcript.add(assistantText);
  try {
    await main(value, session);
  } catch (error) {
    ensureAssistantText().content = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    busy = false;
  }
});
input.focus();

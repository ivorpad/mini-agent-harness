import { expect, test } from "bun:test";
import { OpenAIOAuth, type Credential, type CredentialStore, type OAuthCredential } from "../models/openai-oauth.ts";

function store(initial: Credential) {
  let value: Credential | undefined = initial;
  let pending = Promise.resolve();
  const storage: CredentialStore = {
    async read() { return value; },
    async modify(_provider, update, options) {
      const previous = pending;
      let release!: () => void;
      pending = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try {
        options?.signal?.throwIfAborted();
        const next = await update(value);
        if (next) value = next;
        return value;
      } finally { release(); }
    },
  };
  return { storage, saved: () => value };
}

const expired: OAuthCredential = {
  type: "oauth", access: "old-access", refresh: "old-refresh", expires: 0, clientId: "issued-client",
};
function token(overrides: Record<string, unknown> = {}) {
  return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600,
    scope: "openid chatgpt.tokens.use.direct", ...overrides });
}
function request(fn: (url: string, init: RequestInit) => Promise<Response>): typeof fetch {
  return fn as typeof fetch;
}

test("concurrent refreshes use the issued OpenAI client and save one rotated token", async () => {
  const { storage, saved } = store(expired);
  let calls = 0;
  const oauth = new OpenAIOAuth(storage, request(async (url, init) => {
    calls++;
    expect(url).toBe("https://auth.openai.com/api/accounts/oauth/token");
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("issued-client");
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(body.get("resource")).toBe("https://api.openai.com/v1");
    return token();
  }));
  const [first, second] = await Promise.all([oauth.resolve("openai"), oauth.resolve("openai")]);
  expect(calls).toBe(1);
  expect(first).toEqual(second);
  expect(saved()).toEqual(first);
  expect((first as OAuthCredential).refresh).toBe("new-refresh");
  expect((first as OAuthCredential).clientId).toBe("issued-client");
});

test("API keys and valid OAuth tokens do not refresh", async () => {
  for (const credential of [{ type: "api_key", key: "fixture" } as Credential,
    { ...expired, expires: Date.now() + 3600_000 }]) {
    const { storage } = store(credential);
    const oauth = new OpenAIOAuth(storage, request(async () => { throw new Error("Unexpected fetch"); }));
    expect(await oauth.resolve("openai")).toEqual(credential);
  }
});

test("Codex refresh uses its own endpoint and updates the account ID", async () => {
  const { storage } = store(expired);
  const access = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": {
    chatgpt_account_id: "new-account",
  } })).toString("base64url")}.signature`;
  const oauth = new OpenAIOAuth(storage, request(async (url, init) => {
    expect(url).toBe("https://auth.openai.com/oauth/token");
    const body = init.body as URLSearchParams;
    expect(body.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(body.has("resource")).toBe(false);
    return token({ access_token: access });
  }));
  expect((await oauth.resolve("openai-codex") as OAuthCredential).accountId).toBe("new-account");
});

test("failed or malformed responses leave stored credentials untouched", async () => {
  for (const response of [new Response("old-refresh", { status: 401 }), token({ refresh_token: "" }),
    token({ expires_in: -1 }), token({ scope: "openid" }), token({ expires_in: 1 })]) {
    const { storage, saved } = store(expired);
    const oauth = new OpenAIOAuth(storage, request(async () => response));
    await expect(oauth.resolve("openai")).rejects.toThrow();
    expect(saved()).toEqual(expired);
  }
});

test("cancelling during refresh still saves the rotated token", async () => {
  const { storage, saved } = store(expired);
  const controller = new AbortController();
  const oauth = new OpenAIOAuth(storage, request(async (_url, init) => {
    controller.abort();
    expect(init.signal?.aborted).toBe(false);
    return token();
  }));
  await expect(oauth.resolve("openai", controller.signal)).rejects.toThrow();
  expect((saved() as OAuthCredential).refresh).toBe("new-refresh");
});

test("missing client ID and prior cancellation stop before a request", async () => {
  const { storage } = store({ ...expired, clientId: undefined });
  let calls = 0;
  const oauth = new OpenAIOAuth(storage, request(async () => { calls++; return token(); }));
  await expect(oauth.resolve("openai")).rejects.toThrow("client ID");
  await expect(oauth.resolve("openai", AbortSignal.abort())).rejects.toThrow();
  expect(calls).toBe(0);
});

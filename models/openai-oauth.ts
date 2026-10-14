export interface OAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

export type Credential = OAuthCredential | {
  type: "api_key";
  key?: string;
  env?: Record<string, string>;
};

export interface CredentialStore {
  read(provider: string, options?: { signal?: AbortSignal }): Promise<Credential | undefined>;
  modify(provider: string, update: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: { signal?: AbortSignal }): Promise<Credential | undefined>;
}

export class OpenAIOAuth {
  constructor(private readonly store: CredentialStore, private readonly request: typeof fetch = fetch) {}

  async resolve(provider: string, signal = new AbortController().signal): Promise<Credential> {
    signal.throwIfAborted();
    let credential = await this.store.read(provider, { signal });
    if (!credential) throw new Error(`No saved credentials for ${provider}`);
    if (credential.type !== "oauth" || !this.expiresSoon(credential)) return credential;

    const lockWait = new AbortController();
    const cancelLockWait = () => lockWait.abort(signal.reason);
    signal.addEventListener("abort", cancelLockWait, { once: true });
    if (signal.aborted) cancelLockWait();
    try {
      credential = await this.store.modify(provider, async current => {
        signal.removeEventListener("abort", cancelLockWait);
        signal.throwIfAborted();
        if (current?.type !== "oauth" || !this.expiresSoon(current)) return undefined;
        // Once refresh starts, finish saving the rotated token even if the caller cancels.
        return this.refresh(provider, current, AbortSignal.timeout(15_000));
      }, { signal: lockWait.signal });
    } finally {
      signal.removeEventListener("abort", cancelLockWait);
    }
    if (!credential) throw new Error(`Login removed while refreshing ${provider}`);
    if (credential.type === "oauth" && Date.now() >= credential.expires) {
      throw new Error(`Refreshed ${provider} login is expired`);
    }
    signal.throwIfAborted();
    return credential;
  }

  private expiresSoon(credential: OAuthCredential): boolean {
    return Date.now() + 5 * 60_000 >= credential.expires;
  }

  async refresh(provider: string, credential: OAuthCredential,
    signal = AbortSignal.timeout(15_000)): Promise<OAuthCredential> {
    let url: string;
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: credential.refresh });
    if (provider === "openai") {
      if (typeof credential.clientId !== "string" || !credential.clientId.trim()) {
        throw new Error("Stored OpenAI OAuth credential has no issued client ID; reconnect ChatGPT");
      }
      url = "https://auth.openai.com/api/accounts/oauth/token";
      body.set("client_id", credential.clientId);
      body.set("resource", "https://api.openai.com/v1");
    } else if (provider === "openai-codex") {
      url = "https://auth.openai.com/oauth/token";
      body.set("client_id", "app_EMoamEEZ73f0CkXaXp7hrann");
    } else {
      throw new Error(`OAuth refresh is not implemented for ${provider}`);
    }

    let response: Response;
    try {
      response = await this.request(url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body,
        signal,
      });
    } catch {
      signal.throwIfAborted();
      throw new Error(`OAuth refresh failed for ${provider}: could not reach auth.openai.com`);
    }
    // Do not include server response bodies, which may contain credentials, in errors.
    if (!response.ok) throw new Error(`OAuth refresh failed for ${provider} (HTTP ${response.status})`);
    const token: unknown = await response.json().catch(() => {
      signal.throwIfAborted();
      throw new Error("Invalid OAuth token response");
    });
    if (!token || typeof token !== "object" || Array.isArray(token)) {
      throw new Error("Invalid OAuth token response");
    }
    const data = token as Record<string, unknown>;
    const access = this.tokenString(data.access_token, "access_token");
    const refresh = this.tokenString(data.refresh_token, "refresh_token");
    if (typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new Error("Invalid OAuth expires_in");
    }
    const result: OAuthCredential = {
      ...credential, access, refresh,
      expires: Date.now() + data.expires_in * 1000 - (provider === "openai" ? 3 * 60_000 : 0),
    };
    if (provider === "openai") {
      const scopes = this.tokenString(data.scope, "scope").trim().split(/\s+/);
      if (!scopes.includes("chatgpt.tokens.use.direct")) {
        throw new Error("OpenAI OAuth grant is missing chatgpt.tokens.use.direct");
      }
      result.scopes = scopes;
    } else {
      let accountId: unknown;
      try {
        const payload = JSON.parse(Buffer.from(access.split(".")[1] ?? "", "base64url").toString());
        accountId = payload["https://api.openai.com/auth"]?.chatgpt_account_id;
      } catch {
        throw new Error("Codex OAuth token has no account ID");
      }
      result.accountId = this.tokenString(accountId, "account ID");
    }
    if (Date.now() >= result.expires) throw new Error("OAuth refresh returned an expired token");
    return result;
  }

  private tokenString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid OAuth ${field}`);
    return value;
  }
}

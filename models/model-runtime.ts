
import { homedir } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import { OpenAIOAuth, type Credential, type CredentialStore } from "./openai-oauth.ts";
import type { Message } from "../agent/messages.ts";
import type { ThinkingLevel } from "../agent/types.ts";
import { createProviders, type ModelProvider, type RequestOptions } from "./providers.ts";

export type { Credential };

type AuthData = Record<string, Credential>;

const authPath = join(homedir(), ".pi", "agent", "auth.json");

export interface ModelDefinition {
  provider: string;
  modelName: string;
  api: string;
  baseUrl: string;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}

interface ModelRuntimeInterface {
  getModel(provider: string, modelName: string): ModelDefinition;
}

export function createModels(): Record<string, ModelDefinition> {
  return {
    "openai/gpt-6.1-sol": {
      provider: "openai",
      modelName: "gpt-6.1-sol",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      thinkingLevelMap: { off: null, minimal: null },
    },
    "openai-codex/gpt-6.1-sol": {
      provider: "openai-codex",
      modelName: "gpt-6.1-sol",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
    },
  };
}

export class ModelRuntime implements ModelRuntimeInterface {
  private readonly oauth: OpenAIOAuth;
  private readonly models: Record<string, ModelDefinition>;
  private readonly providers: Map<string, ModelProvider>;

  constructor(auth: AuthData, providers = createProviders(), models = createModels(),
    credentials: CredentialStore = AuthStorage.inMemory(auth)) {
    this.oauth = new OpenAIOAuth(credentials);
    this.models = models;
    this.providers = new Map(providers.map(provider => [provider.id, provider]));
  }

  static async create(options: {
    providers?: ModelProvider[];
    models?: Record<string, ModelDefinition>;
  } = {}): Promise<ModelRuntime> {
    return new ModelRuntime({}, options.providers, options.models, AuthStorage.create(authPath));
  }

  getModel(provider: string, modelName: string): ModelDefinition {
    const model = this.models[`${provider}/${modelName}`];
    if (!model) {
      throw new Error(`Unknown model: ${provider}/${modelName}`);
    }
    return model;
  }

  async complete(model: ModelDefinition, messages: Message[], options: RequestOptions = {}) {
    const provider = this.providers.get(model.provider);
    if (!provider) throw new Error(`Provider not implemented: ${model.provider}`);
    const credential = await this.oauth.resolve(model.provider, options.signal);
    return provider.complete(model, messages, credential, options);
  }
}

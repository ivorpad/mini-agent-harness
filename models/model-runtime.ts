
import { homedir } from "node:os";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai/dist/auth/types.js";
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
  private readonly auth: AuthData;
  private readonly models: Record<string, ModelDefinition>;
  private readonly providers: Map<string, ModelProvider>;

  constructor(auth: AuthData, providers = createProviders(), models = createModels()) {
    this.auth = auth;
    this.models = models;
    this.providers = new Map(providers.map(provider => [provider.id, provider]));
  }

  static async create(options: {
    providers?: ModelProvider[];
    models?: Record<string, ModelDefinition>;
  } = {}): Promise<ModelRuntime> {
    const auth: AuthData = await Bun.file(authPath).json();
    return new ModelRuntime(auth, options.providers, options.models);
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
    const credential = this.auth[model.provider];
    if (!credential) throw new Error(`No saved Pi credentials for ${model.provider}`);
    return provider.complete(model, messages, credential, options);
  }
}

/**
 * Unified LLM Client Adapter
 * Seamlessly adapts OpenAI-compatible providers (like DeepSeek) to Anthropic Messages interface.
 */

import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export type LLMProviderType = 'anthropic' | 'deepseek' | 'openai';

export interface LLMStream {
  on(event: 'text', callback: (delta: string, fullText: string) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  finalMessage(): Promise<Anthropic.Message>;
}

export interface LLMMessageClient {
  provider: LLMProviderType;
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
    stream(params: Anthropic.MessageCreateParamsNonStreaming): LLMStream;
  };
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Parses Server-Sent Events (SSE) from a Web ReadableStream
 */
async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') return;
          try {
            yield JSON.parse(dataStr);
          } catch {
            // Ignore incomplete or non-JSON heartbeats
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * DeepSeek / OpenAI-compatible adapter implementing Anthropic message interface
 */
export class DeepSeekAdapter implements LLMMessageClient {
  public provider: LLMProviderType = 'deepseek';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    // Normalize baseUrl: strip trailing slash and optional /v1
    let url = config.baseUrl.replace(/\/+$/, '');
    if (!url.endsWith('/v1') && !url.includes('/v1/')) {
      url = `${url}/v1`;
    }
    this.baseUrl = url;
    this.defaultModel = config.model || 'deepseek-chat';
  }

  public get messages() {
    return {
      create: (params: Anthropic.MessageCreateParamsNonStreaming) => this.createMessage(params),
      stream: (params: Anthropic.MessageCreateParamsNonStreaming) => this.streamMessage(params),
    };
  }

  /**
   * Translates Anthropic params to OpenAI-compatible chat completion payload
   */
  public transformRequest(params: Anthropic.MessageCreateParamsNonStreaming): {
    model: string;
    messages: any[];
    tools?: any[];
    max_tokens?: number;
    temperature?: number;
  } {
    const messages: any[] = [];

    // 1. System prompt
    let systemText = '';
    if (typeof params.system === 'string') {
      systemText = params.system;
    } else if (Array.isArray(params.system)) {
      systemText = params.system
        .filter((b: any) => b && (b.text || b.type === 'text'))
        .map((b: any) => b.text || '')
        .join('\n');
    }

    if (systemText.trim()) {
      messages.push({ role: 'system', content: systemText.trim() });
    }

    // 2. Chat messages
    for (const msg of params.messages) {
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (Array.isArray(msg.content)) {
        if (msg.role === 'assistant') {
          const textParts: string[] = [];
          const toolCalls: any[] = [];

          for (const block of msg.content) {
            if (block.type === 'text') {
              textParts.push(block.text);
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                  name: block.name,
                  arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
                },
              });
            }
          }

          const assistantContent = textParts.join('\n');
          messages.push({
            role: 'assistant',
            content: assistantContent || (toolCalls.length > 0 ? null : ''),
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          });
        } else if (msg.role === 'user') {
          const userTexts: string[] = [];
          const toolResults: any[] = [];

          for (const block of msg.content) {
            if (block.type === 'text') {
              userTexts.push(block.text);
            } else if (block.type === 'tool_result') {
              const contentStr = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c: any) => (typeof c === 'string' ? c : c?.text || JSON.stringify(c))).join('\n')
                  : JSON.stringify(block.content ?? {});

              const isError = (block as any).is_error;
              toolResults.push({
                role: 'tool',
                tool_call_id: block.tool_use_id,
                content: isError ? `[Error] ${contentStr}` : contentStr,
              });
            }
          }

          if (userTexts.length > 0) {
            messages.push({ role: 'user', content: userTexts.join('\n') });
          }

          for (const tr of toolResults) {
            messages.push(tr);
          }
        }
      }
    }

    // 3. Tools
    let tools: any[] | undefined = undefined;
    if (params.tools && params.tools.length > 0) {
      tools = params.tools.map((t: any) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    // 4. Model mapping: If given a claude-* model name, map to DeepSeek default model
    let targetModel = this.defaultModel;
    if (params.model && !params.model.toLowerCase().includes('claude')) {
      targetModel = params.model;
    }

    return {
      model: targetModel,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(params.max_tokens ? { max_tokens: Math.min(params.max_tokens, 8192) } : {}),
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    };
  }

  /**
   * Non-streaming completion
   */
  public async createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming
  ): Promise<Anthropic.Message> {
    const payload = this.transformRequest(params);
    const endpoint = `${this.baseUrl}/chat/completions`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`DeepSeek API Error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    const choiceMessage = choice?.message || {};

    const contentBlocks: any[] = [];

    if (choiceMessage.content) {
      contentBlocks.push({
        type: 'text',
        text: choiceMessage.content,
      });
    }

    if (choiceMessage.tool_calls && Array.isArray(choiceMessage.tool_calls)) {
      for (const tc of choiceMessage.tool_calls) {
        let inputObj = {};
        try {
          inputObj = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          inputObj = {};
        }
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id || `call_${Date.now()}`,
          name: tc.function?.name || '',
          input: inputObj,
        });
      }
    }

    let stopReason: Anthropic.Message['stop_reason'] = 'end_turn';
    if (choice?.finish_reason === 'tool_calls' || (choiceMessage.tool_calls && choiceMessage.tool_calls.length > 0)) {
      stopReason = 'tool_use';
    } else if (choice?.finish_reason === 'length') {
      stopReason = 'max_tokens';
    }

    return {
      id: data.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: contentBlocks as any,
      model: data.model || payload.model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      } as any,
    } as unknown as Anthropic.Message;
  }

  /**
   * Streaming completion
   */
  public streamMessage(params: Anthropic.MessageCreateParamsNonStreaming): LLMStream {
    const payload = {
      ...this.transformRequest(params),
      stream: true,
    };
    const endpoint = `${this.baseUrl}/chat/completions`;
    const emitter = new EventEmitter() as any;

    let resolveFinal!: (msg: Anthropic.Message) => void;
    let rejectFinal!: (err: any) => void;
    const finalPromise = new Promise<Anthropic.Message>((resolve, reject) => {
      resolveFinal = resolve;
      rejectFinal = reject;
    });

    emitter.finalMessage = () => finalPromise;

    (async () => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`DeepSeek Streaming API Error (${res.status}): ${errText}`);
        }

        if (!res.body) {
          throw new Error('DeepSeek streaming response has no body');
        }

        let fullText = '';
        const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};
        let finishReason: string | null = null;
        let responseId = `msg_${Date.now()}`;
        let responseModel = payload.model;

        for await (const chunk of parseSSE(res.body)) {
          if (chunk.id) responseId = chunk.id;
          if (chunk.model) responseModel = chunk.model;

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          const delta = choice.delta;
          if (!delta) continue;

          if (delta.content) {
            fullText += delta.content;
            emitter.emit('text', delta.content, fullText);
          }

          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsMap[idx]) {
                toolCallsMap[idx] = { id: '', name: '', arguments: '' };
              }
              if (tc.id) toolCallsMap[idx].id = tc.id;
              if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
            }
          }
        }

        const contentBlocks: any[] = [];
        if (fullText) {
          contentBlocks.push({ type: 'text', text: fullText });
        }

        const toolIndices = Object.keys(toolCallsMap).map(Number).sort((a, b) => a - b);
        for (const idx of toolIndices) {
          const tc = toolCallsMap[idx];
          let inputObj = {};
          try {
            inputObj = JSON.parse(tc.arguments || '{}');
          } catch {
            inputObj = {};
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id || `call_${Date.now()}_${idx}`,
            name: tc.name,
            input: inputObj,
          });
        }

        let stopReason: Anthropic.Message['stop_reason'] = 'end_turn';
        if (finishReason === 'tool_calls' || toolIndices.length > 0) {
          stopReason = 'tool_use';
        } else if (finishReason === 'length') {
          stopReason = 'max_tokens';
        }

        const finalMsg = {
          id: responseId,
          type: 'message',
          role: 'assistant',
          content: contentBlocks as any,
          model: responseModel,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          } as any,
        } as unknown as Anthropic.Message;

        resolveFinal(finalMsg);
      } catch (err) {
        rejectFinal(err);
      }
    })();

    return emitter;
  }
}

/**
 * Detects the active provider and credentials from environment variables
 */
export function detectLLMProvider(env = process.env): {
  provider: LLMProviderType;
  apiKey: string;
  baseUrl?: string;
  model?: string;
} {
  const explicit = env.LLM_PROVIDER?.toLowerCase().trim();

  // 1. Explicitly requested DeepSeek
  if (explicit === 'deepseek') {
    const key = env.DEEPSEEK_API_KEY || env.ANTHROPIC_API_KEY || '';
    return {
      provider: 'deepseek',
      apiKey: key.trim(),
      baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
    };
  }

  // 2. Explicit DEEPSEEK_API_KEY provided
  if (env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY.trim()) {
    return {
      provider: 'deepseek',
      apiKey: env.DEEPSEEK_API_KEY.trim(),
      baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
    };
  }

  const anthropicKey = env.ANTHROPIC_API_KEY?.trim() || '';

  // 3. User pasted a DeepSeek / standard OpenAI key into ANTHROPIC_API_KEY
  // DeepSeek keys start with 'sk-' and are hex, while Anthropic keys start with 'sk-ant-'
  if (anthropicKey.startsWith('sk-') && !anthropicKey.startsWith('sk-ant-')) {
    logger.info('Detected OpenAI/DeepSeek key in ANTHROPIC_API_KEY — using DeepSeek adapter');
    return {
      provider: 'deepseek',
      apiKey: anthropicKey,
      baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
    };
  }

  // 4. Default: Anthropic Claude
  return {
    provider: 'anthropic',
    apiKey: anthropicKey,
  };
}

/**
 * Creates the appropriate agent LLM client based on environment
 */
export function createAgentLLMClient(customEnv?: Record<string, string | undefined>): LLMMessageClient {
  const env = customEnv || process.env;
  const config = detectLLMProvider(env);

  if (!config.apiKey) {
    throw new Error('No LLM API key configured. Please set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY in .env');
  }

  if (config.provider === 'deepseek') {
    logger.info({ provider: 'deepseek', model: config.model, baseUrl: config.baseUrl }, 'Using DeepSeek LLM client');
    return new DeepSeekAdapter({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.deepseek.com',
      model: config.model || 'deepseek-chat',
    });
  }

  const anthropic = new Anthropic({ apiKey: config.apiKey });
  return {
    provider: 'anthropic',
    messages: {
      create: (params) => anthropic.messages.create(params) as Promise<Anthropic.Message>,
      stream: (params) => anthropic.messages.stream(params) as unknown as LLMStream,
    },
  };
}

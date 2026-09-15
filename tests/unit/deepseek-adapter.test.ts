import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekAdapter, detectLLMProvider, createAgentLLMClient } from '../../src/agents/llm-client';

describe('DeepSeek Adapter & Provider Detection', () => {
  it('detects DeepSeek provider when DEEPSEEK_API_KEY is set', () => {
    const config = detectLLMProvider({
      DEEPSEEK_API_KEY: 'sk-deepseek-123456',
    });
    assert.equal(config.provider, 'deepseek');
    assert.equal(config.apiKey, 'sk-deepseek-123456');
    assert.equal(config.model, 'deepseek-chat');
  });

  it('detects DeepSeek provider when standard sk- key is in ANTHROPIC_API_KEY', () => {
    const config = detectLLMProvider({
      ANTHROPIC_API_KEY: 'sk-9876543210abcdef',
    });
    assert.equal(config.provider, 'deepseek');
    assert.equal(config.apiKey, 'sk-9876543210abcdef');
  });

  it('detects Anthropic provider when sk-ant- key is provided', () => {
    const config = detectLLMProvider({
      ANTHROPIC_API_KEY: 'sk-ant-api03-abcdefg',
    });
    assert.equal(config.provider, 'anthropic');
    assert.equal(config.apiKey, 'sk-ant-api03-abcdefg');
  });

  it('honors LLM_PROVIDER=deepseek explicitly', () => {
    const config = detectLLMProvider({
      LLM_PROVIDER: 'deepseek',
      ANTHROPIC_API_KEY: 'some-key',
    });
    assert.equal(config.provider, 'deepseek');
    assert.equal(config.apiKey, 'some-key');
  });

  it('correctly transforms Anthropic request to OpenAI format', () => {
    const adapter = new DeepSeekAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });

    const anthropicParams: any = {
      model: 'claude-3-5-sonnet-20241022',
      system: 'You are a trading agent.',
      messages: [
        { role: 'user', content: 'What is the price of BTC?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking price...' },
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'get_price',
              input: { symbol: 'BTC' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: JSON.stringify({ price: 65000 }),
            },
          ],
        },
      ],
      tools: [
        {
          name: 'get_price',
          description: 'Fetch token price',
          input_schema: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
            },
            required: ['symbol'],
          },
        },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    };

    const transformed = adapter.transformRequest(anthropicParams);

    // Claude model is remapped to deepseek-chat
    assert.equal(transformed.model, 'deepseek-chat');

    // System message
    assert.equal(transformed.messages[0].role, 'system');
    assert.equal(transformed.messages[0].content, 'You are a trading agent.');

    // User message
    assert.equal(transformed.messages[1].role, 'user');
    assert.equal(transformed.messages[1].content, 'What is the price of BTC?');

    // Assistant with tool call
    assert.equal(transformed.messages[2].role, 'assistant');
    assert.equal(transformed.messages[2].content, 'Checking price...');
    assert.equal(transformed.messages[2].tool_calls.length, 1);
    assert.equal(transformed.messages[2].tool_calls[0].id, 'call_1');
    assert.equal(transformed.messages[2].tool_calls[0].function.name, 'get_price');

    // Tool result converted to tool role
    assert.equal(transformed.messages[3].role, 'tool');
    assert.equal(transformed.messages[3].tool_call_id, 'call_1');

    // Tools
    assert.equal(transformed.tools?.length, 1);
    assert.equal(transformed.tools?.[0].function.name, 'get_price');
    assert.deepEqual(transformed.tools?.[0].function.parameters, anthropicParams.tools[0].input_schema);
  });

  it('translates OpenAI chat response to Anthropic Message format in createMessage', async () => {
    const adapter = new DeepSeekAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });

    const originalFetch = global.fetch;
    try {
      global.fetch = async () => {
        return {
          ok: true,
          json: async () => ({
            id: 'chatcmpl-test-123',
            model: 'deepseek-chat',
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: 'Let me look that up.',
                  tool_calls: [
                    {
                      id: 'call_999',
                      type: 'function',
                      function: {
                        name: 'fetch_markets',
                        arguments: '{"category":"crypto"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 150,
              completion_tokens: 30,
            },
          }),
        } as any;
      };

      const result = await adapter.createMessage({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Show crypto markets' }],
        max_tokens: 1000,
      });

      assert.equal(result.id, 'chatcmpl-test-123');
      assert.equal(result.role, 'assistant');
      assert.equal(result.stop_reason, 'tool_use');
      assert.equal(result.content.length, 2);
      assert.equal(result.content[0].type, 'text');
      assert.equal(result.content[0].text, 'Let me look that up.');
      assert.equal(result.content[1].type, 'tool_use');
      assert.equal(result.content[1].name, 'fetch_markets');
      assert.deepEqual(result.content[1].input, { category: 'crypto' });
      assert.equal(result.usage.input_tokens, 150);
      assert.equal(result.usage.output_tokens, 30);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('handles streaming SSE deltas and resolves finalMessage', async () => {
    const adapter = new DeepSeekAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });

    const sseChunks = [
      'data: {"id":"chatcmpl-stream-1","choices":[{"delta":{"role":"assistant","content":"Hello"}}]}\n\n',
      'data: {"id":"chatcmpl-stream-1","choices":[{"delta":{"content":" world!"}}]}\n\n',
      'data: {"id":"chatcmpl-stream-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    try {
      global.fetch = async () => {
        return {
          ok: true,
          body: stream,
        } as any;
      };

      const streamClient = adapter.streamMessage({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 50,
      });

      const textDeltas: string[] = [];
      streamClient.on('text', (delta) => {
        textDeltas.push(delta);
      });

      const finalMsg = await streamClient.finalMessage();
      assert.equal(finalMsg.role, 'assistant');
      assert.equal(finalMsg.stop_reason, 'end_turn');
      assert.equal(finalMsg.content[0].type, 'text');
      assert.equal(finalMsg.content[0].text, 'Hello world!');
      assert.deepEqual(textDeltas, ['Hello', ' world!']);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

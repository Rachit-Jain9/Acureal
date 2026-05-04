'use strict';

// Verifies streaming Claude provider:
//   • Subscribes 'text' events from the Anthropic SDK MessageStream and
//     dispatches deltas to onText callbacks.
//   • done() awaits the SDK's finalMessage() and returns { result, raw }.
//   • abort() flips the AbortController so SDK calls cancel.

const mockStream = {
  _listeners: new Map(),
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(cb);
  },
  emit(event, ...args) {
    (this._listeners.get(event) || []).forEach((cb) => cb(...args));
  },
  finalMessage: jest.fn(),
};

const mockMessagesStream = jest.fn(() => mockStream);

jest.mock('@anthropic-ai/sdk', () => ({
  Anthropic: jest.fn().mockImplementation(() => ({
    messages: { stream: mockMessagesStream },
  })),
}));

beforeEach(() => {
  jest.resetModules();
  mockStream._listeners.clear();
  mockStream.finalMessage.mockReset();
  mockMessagesStream.mockClear();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('providerRegistry.runClaudeReasoningStream', () => {
  test('dispatches text deltas to onText listeners', async () => {
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'hello world' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const { runClaudeReasoningStream } = require('../src/services/ai/providerRegistry');

    const stream = await runClaudeReasoningStream({
      systemPrompt: 'sys',
      payload: 'p',
    });

    const received = [];
    stream.onText((delta) => received.push(delta));

    // Simulate the SDK emitting text deltas
    mockStream.emit('text', 'hello ');
    mockStream.emit('text', 'world');

    const final = await stream.done();
    expect(received).toEqual(['hello ', 'world']);
    expect(final.result).toBe('hello world');
    expect(final.raw.usage.input_tokens).toBe(10);
  });

  test('cachePrompt: true wraps system in cache_control block', async () => {
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: 'text', text: '' }],
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const { runClaudeReasoningStream } = require('../src/services/ai/providerRegistry');

    await runClaudeReasoningStream({
      systemPrompt: 'cached system',
      payload: {},
      cachePrompt: true,
    });
    await mockStream.finalMessage();

    const call = mockMessagesStream.mock.calls[0][0];
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('a throwing onText listener does not abort other listeners', async () => {
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'x' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const { runClaudeReasoningStream } = require('../src/services/ai/providerRegistry');

    const stream = await runClaudeReasoningStream({ systemPrompt: 's', payload: 'p' });
    const safe = jest.fn();
    stream.onText(() => { throw new Error('hostile listener'); });
    stream.onText(safe);

    mockStream.emit('text', 'x');
    expect(safe).toHaveBeenCalledWith('x');
  });

  test('abort() does not throw even if controller is already aborted', async () => {
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: 'text', text: '' }],
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const { runClaudeReasoningStream } = require('../src/services/ai/providerRegistry');

    const stream = await runClaudeReasoningStream({ systemPrompt: 's', payload: 'p' });
    expect(() => stream.abort()).not.toThrow();
    expect(() => stream.abort()).not.toThrow();
  });
});

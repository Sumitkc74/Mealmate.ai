import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamAssistantChat } from '@/hooks/useAiPlanner';
import { useAuthStore } from '@/stores/authStore';

describe('streamAssistantChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const messages = [{ role: 'user', content: 'What can I make with tomato?' }] as const;

  function mockFetchStream(chunks: string[]) {
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      ),
    );
  }

  function testUser() {
    return {
      id: '1',
      name: 'Test',
      email: 'test@example.com',
      role: 'user' as const,
      pantry: [],
      dietaryPreferences: [],
      allergies: [],
    };
  }

  it('calls onError when the stream closes without a done event', async () => {
    // The server closed the SSE stream with no events (e.g. the AI service
    // failed after the SSE headers were sent). The UI must not sit on
    // "Assistant is typing" forever — the caller falls back to the
    // non-streaming endpoint from onError.
    useAuthStore.setState({ token: 'test-token', user: testUser() });
    mockFetchStream([]);

    const onToken = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    await streamAssistantChat({ messages: [...messages] }, { onToken, onDone, onError });

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('calls onDone when the stream ends with a done event', async () => {
    useAuthStore.setState({ token: 'test-token', user: testUser() });
    const payload = JSON.stringify({
      type: 'done',
      reply: 'Try tomato soup.',
      strategy: 'llm',
      suggestions: [],
      actions: [],
    });
    mockFetchStream([`data: ${payload}\n\n`]);

    const onToken = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    await streamAssistantChat({ messages: [...messages] }, { onToken, onDone, onError });

    expect(onDone).toHaveBeenCalledTimes(1);
    const doneArg = onDone.mock.calls[0]?.[0];
    expect(doneArg?.reply).toBe('Try tomato soup.');
    expect(onError).not.toHaveBeenCalled();
  });
});

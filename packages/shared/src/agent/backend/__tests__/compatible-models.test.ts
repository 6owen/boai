import { expect, it } from 'bun:test';
import type { LlmConnection } from '../../../config/llm-connections';
import { fetchCompatibleModels } from '../internal/drivers/compatible-models';

const fixtureKey = 'fixture-model-list-key';

async function withEndpoint(
  handler: (request: Request) => Response | Promise<Response>,
  run: (connection: LlmConnection) => Promise<void>,
) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
  try {
    await run({
      slug: 'discovery-fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key',
      baseUrl: `http://127.0.0.1:${server.port}/v1`, customEndpoint: { api: 'openai-responses' },
      createdAt: Date.now(),
    });
  } finally { server.stop(true); }
}

it('discovers and deduplicates compatible model IDs without guessing a catalog', async () => {
  await withEndpoint(request => {
    expect(new URL(request.url).pathname).toBe('/v1/models');
    expect(request.headers.get('authorization')).toBe(`Bearer ${fixtureKey}`);
    return Response.json({ data: [null, { id: ' ' }, { id: 'relay-a', display_name: 'Relay A', context_window: 64_000 }, { id: 'relay-a', display_name: 'Relay A', context_window: 64_000 }, { id: 'relay-b' }] });
  }, async connection => {
    const result = await fetchCompatibleModels(connection, fixtureKey, 1_000);
    expect(result.models.map(m => m.id)).toEqual(['relay-a', 'relay-b']);
    expect(result.models[0]).toMatchObject({ name: 'Relay A', contextWindow: 64_000 });
  });
});

it('rejects authentication failures even when the response contains model data', async () => {
  await withEndpoint(() => Response.json({ data: [{ id: 'denied' }] }, { status: 401 }), async connection => {
    await expect(fetchCompatibleModels(connection, fixtureKey, 1_000)).rejects.toThrow('HTTP 401');
  });
});

it('rejects successful HTTP responses that are not usable model lists', async () => {
  for (const body of [{ success: true }, { data: [] }, { data: [{ name: 'no model ID' }] }]) {
    await withEndpoint(() => Response.json(body), async connection => {
      await expect(fetchCompatibleModels(connection, fixtureKey, 1_000)).rejects.toThrow();
    });
  }
});

it('does not follow redirects with credentials', async () => {
  let requests = 0;
  await withEndpoint(request => {
    requests++;
    return Response.redirect(new URL('/redirected/models', request.url).href);
  }, async connection => {
    await expect(fetchCompatibleModels(connection, fixtureKey, 1_000)).rejects.toThrow();
    expect(requests).toBe(1);
  });
});

it('stops a repeating pagination cursor', async () => {
  let requests = 0;
  await withEndpoint(() => {
    requests++;
    return Response.json({ data: [{ id: 'relay-a' }], has_more: true, last_id: 'relay-a' });
  }, async connection => {
    await expect(fetchCompatibleModels(connection, fixtureKey, 1_000)).rejects.toThrow('invalid model page');
    expect(requests).toBe(2);
  });
});

it('times out a stalled response', async () => {
  await withEndpoint(() => new Response(new ReadableStream()), async connection => {
    await expect(fetchCompatibleModels(connection, fixtureKey, 50)).rejects.toThrow('timed out');
  });
});

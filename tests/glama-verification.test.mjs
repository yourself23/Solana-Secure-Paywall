import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Glama verification uses the same public JSON file for both routes', () => {
  const claimPath = '/.well-known/glama.json';
  const mcpPath = '/api/mcp/.well-known/glama.json';
  const claim = JSON.parse(readFileSync(`public${claimPath}`, 'utf8'));
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));

  assert.deepEqual(claim, {
    $schema: 'https://glama.ai/mcp/schemas/connector.json',
    claim: 'glama_claim_t_y59mtIiOKsquL2qNQHTfJc7F6w2xk0',
  });
  assert.deepEqual(config.rewrites[0], { source: mcpPath, destination: claimPath });
  for (const path of [claimPath, mcpPath]) {
    assert.ok(config.headers.some(({ source, headers }) =>
      source === path && headers.some(({ key, value }) =>
        key.toLowerCase() === 'content-type' && value === 'application/json')));
  }
});

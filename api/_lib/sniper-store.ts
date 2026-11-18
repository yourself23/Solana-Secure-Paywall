export async function sniperRedis(command: (string | number)[]) {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) throw new Error('Upstash Redis is not configured');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`Redis error: ${body.error}`);
  return body.result;
}

export function sniperJobKey(id: string) {
  return `sniper:job:${id}`;
}

export function validSniperJobId(id: string) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

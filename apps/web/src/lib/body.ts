// Reads a JSON body with a size cap, so an oversized request is refused before it is parsed or
// validated (a large array can make a schema validator allocate out of proportion). 64 KB covers every
// request the site makes; the few routes that take files set their own limit.
export class BodyTooLarge extends Error {
  status = 413;
  constructor(limit: number) {
    super(`Request body is larger than ${Math.round(limit / 1024)} KB.`);
  }
}

export async function readJson<T = unknown>(req: Request, limit = 64 * 1024): Promise<T> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > limit) throw new BodyTooLarge(limit);
  const raw = await req.text();
  if (raw.length > limit) throw new BodyTooLarge(limit);
  return JSON.parse(raw) as T;
}

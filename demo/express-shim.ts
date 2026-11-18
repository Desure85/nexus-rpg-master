// Мини-реализация Express-маршрутизации для работы серверного кода прямо в браузере.
type Handler = (...a: any[]) => any;
interface Layer { method: string | null; keys: string[]; re: RegExp; prefix: boolean; handlers: Handler[] }

const compile = (path: string, prefix: boolean) => {
  const keys: string[] = [];
  const src = path.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, m => (m === '$' ? '\\$' : `\\${m}`))
    .replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; });
  return { keys, re: new RegExp(`^${src}${prefix ? '(?=/|$)' : '/?$'}`, 'i') };
};

export interface DemoRequest { method: string; url: string; headers: Record<string, string>; body?: any; ip?: string }
export interface DemoResponse { status: number; headers: Record<string, string[]>; body: any }

export function createApp() {
  const layers: Layer[] = [];
  const add = (method: string | null, args: any[]) => {
    let path = '/';
    if (typeof args[0] === 'string') path = args.shift();
    const prefix = method === null;
    const { keys, re } = compile(path, prefix);
    layers.push({ method, keys, re, prefix, handlers: args.flat() });
  };
  const app: any = {
    use: (...a: any[]) => add(null, a),
    set: () => app,
    enable: () => app,
    disable: () => app,
  };
  for (const m of ['get', 'post', 'put', 'delete', 'patch']) app[m] = (...a: any[]) => add(m.toUpperCase(), a);

  app.handle = (input: DemoRequest): Promise<DemoResponse> => new Promise(resolve => {
    const [pathname, qs = ''] = input.url.split('?');
    const headers = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const listeners: Record<string, Handler[]> = {};
    const out: DemoResponse = { status: 200, headers: {}, body: undefined };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      res.headersSent = true;
      resolve(out);
      setTimeout(() => { for (const ev of ['finish', 'close']) for (const l of listeners[ev] || []) l(); }, 0);
    };
    const req: any = {
      method: input.method.toUpperCase(),
      originalUrl: input.url,
      url: input.url,
      path: pathname,
      query: Object.fromEntries(new URLSearchParams(qs)),
      headers,
      body: input.body === undefined ? {} : JSON.parse(JSON.stringify(input.body)),
      params: {},
      ip: input.ip || 'demo',
      protocol: location.protocol.replace(':', ''),
      secure: location.protocol === 'https:',
      get: (h: string) => headers[h.toLowerCase()],
      header: (h: string) => headers[h.toLowerCase()],
    };
    const res: any = {
      headersSent: false,
      statusCode: 200,
      status(c: number) { out.status = c; res.statusCode = c; return res; },
      setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = [String(v)]; return res; },
      getHeader(k: string) { return out.headers[k.toLowerCase()]?.[0]; },
      append(k: string, v: string) { (out.headers[k.toLowerCase()] ||= []).push(String(v)); return res; },
      json(b: any) { out.body = b === undefined ? null : JSON.parse(JSON.stringify(b)); finish(); return res; },
      send(b: any) { out.body = b; finish(); return res; },
      end() { finish(); return res; },
      sendStatus(c: number) { out.status = c; finish(); return res; },
      redirect(a: any, b?: any) { out.status = typeof a === 'number' ? a : 302; res.setHeader('location', String(b ?? a)); finish(); return res; },
      on(ev: string, fn: Handler) { (listeners[ev] ||= []).push(fn); return res; },
    };

    // плоский список (layer, handler)
    const chain: { layer: Layer; fn: Handler }[] = [];
    for (const layer of layers) for (const fn of layer.handlers) chain.push({ layer, fn });
    let i = 0;
    const next = (err?: any) => {
      if (done) return;
      while (i < chain.length) {
        const { layer, fn } = chain[i++];
        if (layer.method && layer.method !== req.method) continue;
        const m = layer.re.exec(pathname);
        if (!m) continue;
        const isErr = fn.length === 4;
        if (!!err !== isErr) continue;
        const params: Record<string, string> = {};
        layer.keys.forEach((k, j) => { params[k] = decodeURIComponent(m[j + 1]); });
        req.params = params;
        req.path = layer.prefix ? pathname.slice(m[0].length) || '/' : pathname;
        try {
          const r = isErr ? fn(err, req, res, next) : fn(req, res, next);
          if (r && typeof r.catch === 'function') r.catch((e: any) => next(e));
        } catch (e) { next(e); }
        return;
      }
      if (err) { console.error('[demo-server]', err); out.status = 500; out.body = { error: 'internal', message: String(err?.message || err) }; }
      else { out.status = 404; out.body = { error: 'not_found' }; }
      finish();
    };
    next();
  });
  return app;
}

export default createApp;

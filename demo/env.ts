// Окружение задаётся в index.html (demo/env.js). Здесь — страховка для запуска вне index.html.
const g = globalThis as any;
g.__nexusEnv = g.__nexusEnv || { LLM_PROVIDER: 'mock', DEFAULT_PROVIDER: 'mock', PAYMENTS_PROVIDER: 'mock' };
g.process = g.process || { env: g.__nexusEnv };
export {};

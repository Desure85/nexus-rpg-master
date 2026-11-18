declare module 'virtual:nexus-transport' {
  export const demoFetch: (path: string, init: RequestInit) => Promise<Response>;
  export const demoSubscribe: (sessionId: string, fn: (e: any) => void) => () => void;
  export const demoReset: () => Promise<void>;
  export const demoForgetKeys: () => Promise<void>;
}

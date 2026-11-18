// В обычной сборке демо-транспорт не нужен.
export const demoFetch = (path: string, init: RequestInit) => fetch(path, init);
export const demoSubscribe = (_id: string, _fn: (e: any) => void) => () => undefined;
export const demoReset = async () => undefined;

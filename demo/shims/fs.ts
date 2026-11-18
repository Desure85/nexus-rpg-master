const noop = () => undefined;
export default { existsSync: () => true, mkdirSync: noop, readFileSync: () => '', writeFileSync: noop };
export const existsSync = () => true;

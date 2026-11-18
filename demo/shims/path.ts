const dirname = (p: string) => p.split('/').slice(0, -1).join('/') || '.';
const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/');
const resolve = (...parts: string[]) => join(...parts);
export default { dirname, join, resolve, sep: '/' };
export { dirname, join, resolve };

/**
 * Защита от SSRF: адреса, которые задают пользователи (свой URL модели в BYOK), не должны вести во внутреннюю сеть сервера.
 * Проверяем все IP, в которые резолвится хост (а не только написанное в URL), — иначе обход через DNS.
 */
import dns from "node:dns";
import net from "node:net";

const v4 = (ip: string) => ip.split(".").map(Number);
export const isPrivateIp = (ip: string): boolean => {
  if (net.isIPv4(ip)) {
    const [a, b] = v4(ip);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
  }
  return true;
};

export async function assertPublicUrl(url: string) {
  if (process.env.ALLOW_PRIVATE_MODEL_URL === "true") return;
  let u: URL;
  try { u = new URL(url); } catch { throw Object.assign(new Error("Некорректный URL модели"), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error("URL модели должен быть http(s)"), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map(a => a.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw Object.assign(new Error("URL модели ведёт во внутреннюю сеть — укажите публичный адрес"), { status: 400 });
}

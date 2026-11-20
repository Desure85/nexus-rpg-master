import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertPublicUrl } from '../server/netguard';

describe('SSRF: свой URL модели не ведёт во внутреннюю сеть', () => {
  it('частные, служебные и петлевые адреса', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2a00:1450:4010::64'])
      expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('URL с внутренним адресом или localhost отклоняется', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/внутреннюю сеть/);
    await expect(assertPublicUrl('http://localhost:11434/v1')).rejects.toThrow(/внутреннюю сеть/);
    await expect(assertPublicUrl('http://[::1]:8080/v1')).rejects.toThrow(/внутреннюю сеть/);
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/http/);
    await expect(assertPublicUrl('http://8.8.8.8/v1')).resolves.toBeUndefined();
  });
});

import { lookup } from 'node:dns/promises';
import {
  isPublicAddress,
  resolvePublicSource,
  validateSourceUrl,
} from './safe-source-http';
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

describe('source network boundary', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.2',
    '172.16.2.2',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2001:0db8::1',
    '2001:0020::1',
    '2001:0010::1',
    '2001:0000::1',
    '2002:7f00:1::',
  ])('rejects nonpublic address %s', (ip) =>
    expect(isPublicAddress(ip)).toBe(false),
  );
  it('accepts global routable families', () => {
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('rejects a mixed public/private DNS answer before opening a socket', async () => {
    jest.mocked(lookup).mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never);
    await expect(resolvePublicSource('www.threads.com')).rejects.toThrow(
      'UNSAFE_SOURCE_ADDRESS',
    );
  });
  it('allowlists navigation and subresources separately, including redirect targets', () => {
    expect(
      validateSourceUrl('https://www.threads.com/@a/post/b').hostname,
    ).toBe('www.threads.com');
    expect(
      validateSourceUrl('https://static.cdninstagram.com/script.js', true)
        .hostname,
    ).toBe('static.cdninstagram.com');
    for (const url of [
      'https://169.254.169.254/latest/meta-data',
      'file:///etc/passwd',
      'https://threads.com.evil.test/x',
      'https://threads.com:444/x',
      'http://threads.com/x',
    ]) {
      expect(() => validateSourceUrl(url, true)).toThrow();
    }
    expect(() =>
      validateSourceUrl('https://static.cdninstagram.com/x'),
    ).toThrow();
  });
});

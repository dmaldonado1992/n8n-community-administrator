import dns from 'node:dns/promises';
import net from 'node:net';

const privateIpv4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

function hostMatches(hostname, allowed) {
  return allowed.some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`));
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) return privateIpv4.some((pattern) => pattern.test(address));
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return true;
}

export async function validatePublicJobUrl(value, allowedHosts) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Only HTTPS vacancy URLs are allowed');
  if (!hostMatches(url.hostname.toLowerCase(), allowedHosts)) throw new Error(`Host not allowed for this platform: ${url.hostname}`);
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Vacancy URL resolves to a private or unsafe address');
  }
  return url;
}

export function assertAuthorized(request, token) {
  const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || supplied !== token) {
    const error = new Error('Unauthorized');
    error.statusCode = 401;
    throw error;
  }
}


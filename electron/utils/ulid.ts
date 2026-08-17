import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(value: bigint, length: number): string {
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

/** Time-ordered id for code-application create (matches sto-app CLI). */
export function createUlid(now = Date.now()): string {
  const timestamp = encodeBase32(BigInt(now), 10);
  const random = randomBytes(10);
  let randomValue = 0n;
  for (const byte of random) {
    randomValue = (randomValue << 8n) | BigInt(byte);
  }
  return timestamp + encodeBase32(randomValue, 16);
}

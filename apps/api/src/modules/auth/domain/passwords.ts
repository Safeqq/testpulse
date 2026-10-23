import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// Hash dummy untuk menyetarakan waktu respons saat email tidak ditemukan.
const DUMMY_HASH = `${"00".repeat(SALT_BYTES)}:${"00".repeat(KEY_LENGTH)}`;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Format hasil: `salt:hash`, keduanya hex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex, ...rest] = stored.split(":");
  if (!saltHex || !hashHex || rest.length > 0) return false;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, Buffer.from(saltHex, "hex"));
  return timingSafeEqual(actual, expected);
}

/** Menjalankan scrypt terhadap hash dummy; selalu mengembalikan false. */
export async function burnPasswordCheck(password: string): Promise<false> {
  await verifyPassword(password, DUMMY_HASH);
  return false;
}

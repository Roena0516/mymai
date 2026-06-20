import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const ENCODING: BufferEncoding = "hex";

let encryptionKey: Buffer | null = null;

export function initEncryption(rawKey: string | undefined): void {
  if (!rawKey) {
    const generated = crypto.randomBytes(KEY_LENGTH).toString(ENCODING);
    const configPath = path.resolve(__dirname, "..", "config.json");
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      config.encryptionKey = generated;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      console.log("[maimai] 🔑 encryptionKey 자동 생성 → config.json에 저장됨");
    } catch {
      console.warn("[maimai] ⚠️  encryptionKey를 config.json에 저장할 수 없습니다.");
    }
    rawKey = generated;
  }
  encryptionKey = crypto.createHash("sha256").update(rawKey).digest();
}

function ensureKey(): Buffer {
  if (!encryptionKey) {
    throw new Error("encryption not initialized — call initEncryption() first");
  }
  return encryptionKey;
}

/**
 * 평문 문자열을 AES-256-GCM으로 암호화.
 * 반환값: iv:ciphertext:tag (hex 인코딩, ":"로 구분)
 */
export function encrypt(plaintext: string): string {
  const key = ensureKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", ENCODING);
  encrypted += cipher.final(ENCODING);
  const tag = cipher.getAuthTag().toString(ENCODING);

  return `${iv.toString(ENCODING)}:${encrypted}:${tag}`;
}

/**
 * 암호화된 문자열을 복호화.
 * 입력값: iv:ciphertext:tag (encrypt()의 반환값)
 */
export function decrypt(encoded: string): string {
  const key = ensureKey();
  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("invalid encrypted data format");
  }

  const [ivHex, encryptedHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, ENCODING);
  const tag = Buffer.from(tagHex, ENCODING);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedHex, ENCODING, "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

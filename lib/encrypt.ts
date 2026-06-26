/**
 * AES-256-GCM encryption for API keys stored in Supabase.
 * Secret loaded from API_KEY_ENCRYPTION_SECRET env var (32-byte hex string).
 * Never returns plaintext to the client — only used server-side.
 */

const ALG = 'AES-GCM'
const IV_BYTES = 12  // 96-bit IV recommended for GCM

function getSecretKey(): Promise<CryptoKey> {
  const hex = process.env.API_KEY_ENCRYPTION_SECRET?.trim()
  if (!hex || hex.length !== 64) throw new Error('API_KEY_ENCRYPTION_SECRET must be exactly 64 hex characters (32 bytes)')
  const raw = Buffer.from(hex.slice(0, 64), 'hex')
  return crypto.subtle.importKey('raw', raw, { name: ALG }, false, ['encrypt', 'decrypt'])
}

/** Encrypts plaintext → base64 string (iv:ciphertext) */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getSecretKey()
  const iv  = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const enc = await crypto.subtle.encrypt(
    { name: ALG, iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  const ivB64   = Buffer.from(iv).toString('base64')
  const dataB64 = Buffer.from(enc).toString('base64')
  return `${ivB64}:${dataB64}`
}

/** Decrypts base64 string (iv:ciphertext) → plaintext. Returns null on any failure. */
export async function decrypt(ciphertext: string): Promise<string | null> {
  try {
    const [ivB64, dataB64] = ciphertext.split(':')
    if (!ivB64 || !dataB64) return null
    const key  = await getSecretKey()
    const iv   = Buffer.from(ivB64, 'base64')
    const data = Buffer.from(dataB64, 'base64')
    const dec  = await crypto.subtle.decrypt({ name: ALG, iv }, key, data)
    return new TextDecoder().decode(dec)
  } catch {
    return null
  }
}

/**
 * AES-CBC decryption with PKCS#7 padding, in plain TypeScript.
 *
 * Dizipal (2026-09-27) stopped sending the embed URL in the clear: the
 * player-config answer carries `enc: { c, iv, k1, k2 }` and its page decrypts
 * it with CryptoJS (AES-256-CBC, key = k1 XOR k2). React Native has no
 * WebCrypto and a crypto module would be native (not OTA-deliverable), so the
 * block cipher lives here. Only decryption is needed.
 */

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);

// GF(2^8) multiply, for the S-box inverse and InvMixColumns.
function gmul(a: number, b: number): number {
  let product = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) product ^= a;
    const carry = a & 0x80;
    a = (a << 1) & 0xff;
    if (carry) a ^= 0x1b;
    b >>= 1;
  }
  return product;
}

(function buildSboxes() {
  for (let x = 0; x < 256; x++) {
    let inverse = 0;
    if (x !== 0) {
      for (let y = 1; y < 256; y++) {
        if (gmul(x, y) === 1) {
          inverse = y;
          break;
        }
      }
    }
    let s = inverse;
    for (let shift = 1; shift <= 4; shift++) {
      s ^= ((inverse << shift) | (inverse >> (8 - shift))) & 0xff;
    }
    s ^= 0x63;
    SBOX[x] = s;
    INV_SBOX[s] = x;
  }
})();

function expandKey(key: Uint8Array): Uint8Array[] {
  const nk = key.length / 4;
  const rounds = nk + 6;
  const words: number[][] = [];
  for (let i = 0; i < nk; i++) words.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);

  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    let temp = words[i - 1].slice();
    if (i % nk === 0) {
      temp = [SBOX[temp[1]] ^ rcon, SBOX[temp[2]], SBOX[temp[3]], SBOX[temp[0]]];
      rcon = gmul(rcon, 2);
    } else if (nk > 6 && i % nk === 4) {
      temp = temp.map((byte) => SBOX[byte]);
    }
    words.push(words[i - nk].map((byte, j) => byte ^ temp[j]));
  }

  const roundKeys: Uint8Array[] = [];
  for (let round = 0; round <= rounds; round++) {
    roundKeys.push(Uint8Array.from(words.slice(4 * round, 4 * round + 4).flat()));
  }
  return roundKeys;
}

function decryptBlock(input: Uint8Array, roundKeys: Uint8Array[]): Uint8Array {
  const rounds = roundKeys.length - 1;
  // A copy, never a view: Buffer#slice would share (and corrupt) the input.
  const state = Uint8Array.from(input);
  const addRoundKey = (round: number) => {
    for (let i = 0; i < 16; i++) state[i] ^= roundKeys[round][i];
  };
  // State is column-major: byte (row r, column c) sits at 4c + r.
  const invShiftRowsAndSubBytes = () => {
    const copy = state.slice();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) state[4 * ((c + r) % 4) + r] = INV_SBOX[copy[4 * c + r]];
    }
  };

  addRoundKey(rounds);
  for (let round = rounds - 1; round >= 1; round--) {
    invShiftRowsAndSubBytes();
    addRoundKey(round);
    for (let c = 0; c < 4; c++) {
      const [a0, a1, a2, a3] = [state[4 * c], state[4 * c + 1], state[4 * c + 2], state[4 * c + 3]];
      state[4 * c] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
      state[4 * c + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
      state[4 * c + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
      state[4 * c + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
    }
  }
  invShiftRowsAndSubBytes();
  addRoundKey(0);
  return state;
}

/**
 * Decrypt AES-CBC ciphertext (128/192/256-bit key) and strip PKCS#7 padding.
 * Returns null on a malformed key, IV, length or padding — i.e. a wrong key.
 */
export function aesCbcDecrypt(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array | null {
  if (![16, 24, 32].includes(key.length) || iv.length !== 16) return null;
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) return null;

  const roundKeys = expandKey(key);
  const plain = new Uint8Array(ciphertext.length);
  let previous = iv;
  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    const block = ciphertext.subarray(offset, offset + 16);
    const decrypted = decryptBlock(block, roundKeys);
    for (let i = 0; i < 16; i++) plain[offset + i] = decrypted[i] ^ previous[i];
    previous = block;
  }

  const pad = plain[plain.length - 1];
  if (pad < 1 || pad > 16) return null;
  for (let i = plain.length - pad; i < plain.length; i++) {
    if (plain[i] !== pad) return null;
  }
  return plain.subarray(0, plain.length - pad);
}

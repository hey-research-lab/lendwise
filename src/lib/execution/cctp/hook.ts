import { StrKey } from '@stellar/stellar-sdk'
import { type Hex, bytesToHex, hexToBytes } from 'viem'

// Circle's CctpForwarder hook layout (cctp-forwarder/src/message.rs):
// bytes 0–23 reserved zeros, 24–27 version (uint32, 0), 28–31 recipient length
// L (uint32), then the recipient strkey as UTF-8 on L bytes, then an optional
// integrator payload.
const RESERVED = 24
const HOOK_VERSION = 0
const HEADER = 32

function isStellarRecipient(value: string): boolean {
  return (
    StrKey.isValidEd25519PublicKey(value) ||
    StrKey.isValidMed25519PublicKey(value) ||
    StrKey.isValidContract(value)
  )
}

/** A Soroban contract id as the bytes32 CCTP puts in `mintRecipient` / `destinationCaller`. */
export function contractIdToBytes32(contractId: string): Hex {
  if (!StrKey.isValidContract(contractId)) {
    throw new Error(`Not a Stellar contract id: ${contractId}`)
  }
  return bytesToHex(StrKey.decodeContract(contractId))
}

export function bytes32ToContractId(b: Hex): string {
  const bytes = hexToBytes(b)
  if (bytes.length !== 32) throw new Error('Expected 32 bytes')
  return StrKey.encodeContract(Buffer.from(bytes))
}

export function encodeForwarderHookData(
  recipient: string,
  payload: Uint8Array = new Uint8Array()
): Hex {
  if (!isStellarRecipient(recipient)) {
    throw new Error('Forward recipient must be a Stellar G, M or C address')
  }
  const strkey = new TextEncoder().encode(recipient)
  const out = new Uint8Array(HEADER + strkey.length + payload.length)
  const view = new DataView(out.buffer)
  view.setUint32(RESERVED, HOOK_VERSION, false)
  view.setUint32(RESERVED + 4, strkey.length, false)
  out.set(strkey, HEADER)
  out.set(payload, HEADER + strkey.length)
  return bytesToHex(out)
}

export function decodeForwarderHookData(hook: Hex): {
  recipient: string
  payload: Hex
} {
  const bytes = hexToBytes(hook)
  if (bytes.length < HEADER) {
    throw new Error('Hook data is shorter than its 32-byte header')
  }
  if (bytes.slice(0, RESERVED).some((b) => b !== 0)) {
    throw new Error('Hook data reserved bytes are not zero')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(RESERVED, false)
  if (version !== HOOK_VERSION) {
    throw new Error(`Unsupported hook data version ${version}`)
  }
  const length = view.getUint32(RESERVED + 4, false)
  if (HEADER + length > bytes.length) {
    throw new Error('Hook data recipient length exceeds the data')
  }
  const recipient = new TextDecoder().decode(
    bytes.slice(HEADER, HEADER + length)
  )
  if (!isStellarRecipient(recipient)) {
    throw new Error('Hook data recipient is not a Stellar address')
  }
  return { recipient, payload: bytesToHex(bytes.slice(HEADER + length)) }
}

import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  type Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'

export type SignedTxErrorCode =
  | 'parse'
  | 'fee-bump'
  | 'source'
  | 'unsigned'
  | 'bad-signature'
  | 'wrong-network'
  | 'operations'
  | 'operation'
  | 'asset'
  | 'contract'
  | 'function'
  | 'arguments'

export class SignedTxError extends Error {
  constructor(
    public code: SignedTxErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SignedTxError'
  }
}

function otherPassphrase(passphrase: string): string | null {
  if (passphrase === Networks.PUBLIC) return Networks.TESTNET
  if (passphrase === Networks.TESTNET) return Networks.PUBLIC
  return null
}

function signedBy(tx: Transaction, source: string): boolean {
  const kp = Keypair.fromPublicKey(source)
  const hint = Buffer.from(kp.signatureHint())
  const hash = tx.hash()
  return tx.signatures.some(
    (s) => Buffer.from(s.hint()).equals(hint) && kp.verify(hash, s.signature())
  )
}

/**
 * Reads an envelope the wallet signed and proves `source` signed it for
 * `passphrase`. The XDR does not carry the network: a transaction signed for
 * the other network parses fine and only its signature gives it away, so that
 * case is named (`wrong-network`) instead of failing as a bad signature.
 */
export function parseSignedTransaction(
  xdr: string,
  passphrase: string,
  source: string
): Transaction {
  let parsed: Transaction | FeeBumpTransaction
  try {
    parsed = TransactionBuilder.fromXDR(xdr, passphrase)
  } catch {
    throw new SignedTxError('parse', 'The signed transaction could not be read')
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new SignedTxError(
      'fee-bump',
      'Fee-bump transactions are not accepted'
    )
  }
  if (parsed.source !== source) {
    throw new SignedTxError(
      'source',
      'The transaction source is not your signed-in Stellar account'
    )
  }
  if (parsed.signatures.length === 0) {
    throw new SignedTxError('unsigned', 'The transaction is not signed')
  }
  if (signedBy(parsed, source)) return parsed

  const other = otherPassphrase(passphrase)
  if (
    other &&
    signedBy(TransactionBuilder.fromXDR(xdr, other) as Transaction, source)
  ) {
    throw new SignedTxError(
      'wrong-network',
      'Your wallet signed for the other Stellar network. Switch it to the network this page uses and sign again.'
    )
  }
  throw new SignedTxError(
    'bad-signature',
    'The signature is not valid for your account'
  )
}

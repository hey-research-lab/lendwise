import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  type HorizonAccount,
  MAX_TRUSTLINE_LIMIT,
  SignedTxError,
  assertSignedChangeTrust,
  buildChangeTrustXdr,
  fetchHorizonAccount,
  isChangeTrustBy,
  preflightFromAccount,
} from '../trustline'

const USDC = {
  code: 'USDC' as const,
  issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  contractId: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
}
const TWENTY_USDC = 200_000_000n // Stellar units

function account(
  native: string,
  extra: Partial<HorizonAccount> = {},
  lines: HorizonAccount['balances'] = []
): HorizonAccount {
  return {
    sequence: '100',
    subentry_count: lines.length,
    ...extra,
    balances: [
      ...lines,
      {
        asset_type: 'native',
        balance: native,
        selling_liabilities: '0.0000000',
      },
    ],
  }
}

const usdcLine = (balance: string, limit: string, more: object = {}) => ({
  asset_type: 'credit_alphanum4',
  asset_code: 'USDC',
  asset_issuer: USDC.issuer,
  balance,
  limit,
  ...more,
})

describe('preflightFromAccount', () => {
  it('reports an account that does not exist yet', () => {
    expect(preflightFromAccount(null, USDC, TWENTY_USDC)).toEqual({
      state: 'unfunded',
      availableXlm: '0',
      requiredXlm: '1.6',
      trustline: null,
    })
  })

  it('asks for a trustline when the account can afford its reserve', () => {
    expect(
      preflightFromAccount(account('10.0000000'), USDC, TWENTY_USDC)
    ).toEqual({
      state: 'missing-trustline',
      availableXlm: '9',
      requiredXlm: '0.6',
      trustline: null,
    })
  })

  it('asks for XLM first when the trustline reserve is not covered', () => {
    expect(
      preflightFromAccount(account('1.5000000'), USDC, TWENTY_USDC).state
    ).toBe('insufficient-xlm')
  })

  it('ignores a USDC line from another issuer', () => {
    const fake = {
      ...usdcLine('0', '1000'),
      asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    }
    expect(
      preflightFromAccount(account('10', {}, [fake]), USDC, TWENTY_USDC).state
    ).toBe('missing-trustline')
  })

  it('blocks an unauthorized trustline', () => {
    const a = account('10', {}, [
      usdcLine('0', '922337203685.4775807', { is_authorized: false }),
    ])
    expect(preflightFromAccount(a, USDC, TWENTY_USDC).state).toBe(
      'not-authorized'
    )
  })

  it('needs fee margin even when the trustline exists', () => {
    const a = account('1.5400000', {}, [usdcLine('0', '922337203685.4775807')]) // 1.54 − 1.5 reserve
    expect(preflightFromAccount(a, USDC, TWENTY_USDC)).toMatchObject({
      state: 'insufficient-xlm',
      requiredXlm: '0.1',
    })
  })

  it('asks to raise a limit that the transfer would exceed', () => {
    const a = account('10', {}, [usdcLine('90.0000000', '100.0000000')])
    expect(preflightFromAccount(a, USDC, TWENTY_USDC)).toMatchObject({
      state: 'limit-too-low',
      trustline: { balance: '90.0000000', limit: '100.0000000' },
    })
  })

  it('is ready with a trustline, room under the limit and fee margin', () => {
    const a = account('5', {}, [usdcLine('0.0000000', '922337203685.4775807')])
    expect(preflightFromAccount(a, USDC, TWENTY_USDC)).toEqual({
      state: 'ready',
      availableXlm: '3.5',
      requiredXlm: '0.1',
      trustline: { balance: '0.0000000', limit: '922337203685.4775807' },
    })
  })

  it('compares the mint fee with the available XLM and asks for that fee plus margin', () => {
    const a = account('5', {}, [usdcLine('0.0000000', '922337203685.4775807')]) // 3.5 available
    expect(
      preflightFromAccount(a, USDC, TWENTY_USDC, 40_000_000n) // 4 XLM fee
    ).toMatchObject({
      state: 'insufficient-xlm',
      availableXlm: '3.5',
      requiredXlm: '4.1',
    })
    expect(
      preflightFromAccount(a, USDC, TWENTY_USDC, 2_500_000n) // 0.25 XLM fee
    ).toMatchObject({ state: 'ready', requiredXlm: '0.35' })
  })

  it('counts sponsorships and selling liabilities against the available XLM', () => {
    const a = account('5', { num_sponsoring: 1, num_sponsored: 1 }, [
      usdcLine('0', '1000'),
    ])
    a.balances[1].selling_liabilities = '1.0000000'
    // 2 + 1 subentry + 1 sponsoring − 1 sponsored = 3 reserves = 1.5 XLM; minus 1 XLM liabilities
    expect(preflightFromAccount(a, USDC, TWENTY_USDC).availableXlm).toBe('2.5')
  })
})

describe('fetchHorizonAccount', () => {
  it('returns null for an unfunded account (404)', async () => {
    const fetchFn = vi.fn(
      async (_url: string) => new Response(null, { status: 404 })
    )
    expect(
      await fetchHorizonAccount('GABC', {
        horizonUrl: 'https://h',
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).toBeNull()
    expect(fetchFn.mock.calls[0][0]).toBe('https://h/accounts/GABC')
  })

  it('throws on any other HTTP error', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 503 }))
    await expect(
      fetchHorizonAccount('GABC', {
        horizonUrl: 'https://h',
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).rejects.toThrow(/503/)
  })
})

describe('buildChangeTrustXdr', () => {
  it('builds one unlimited USDC ChangeTrust at the next sequence', async () => {
    const kp = Keypair.random()
    const fetchFn = vi.fn(async () => Response.json(account('10')))
    const xdr = await buildChangeTrustXdr(kp.publicKey(), {
      horizonUrl: 'https://h',
      passphrase: Networks.PUBLIC,
      usdc: USDC,
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC) as Transaction
    expect(tx.source).toBe(kp.publicKey())
    expect(tx.sequence).toBe('101')
    expect(tx.operations).toHaveLength(1)
    const op = tx.operations[0]
    expect(op.type).toBe('changeTrust')
    if (op.type !== 'changeTrust') return
    expect((op.line as Asset).getCode()).toBe('USDC')
    expect((op.line as Asset).getIssuer()).toBe(USDC.issuer)
    expect(op.limit).toBe(MAX_TRUSTLINE_LIMIT)
  })

  it('refuses to build for an account that does not exist', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }))
    await expect(
      buildChangeTrustXdr('GABC', {
        horizonUrl: 'https://h',
        passphrase: Networks.PUBLIC,
        usdc: USDC,
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).rejects.toThrow(/not exist/)
  })
})

describe('assertSignedChangeTrust', () => {
  const kp = Keypair.random()

  function signed(
    opts: {
      passphrase?: string
      asset?: Asset
      ops?: number
      limit?: string
      payment?: boolean
      source?: Keypair
      signer?: Keypair | null
    } = {}
  ): string {
    const source = opts.source ?? kp
    const b = new TransactionBuilder(new Account(source.publicKey(), '100'), {
      fee: BASE_FEE,
      networkPassphrase: opts.passphrase ?? Networks.PUBLIC,
    })
    for (let i = 0; i < (opts.ops ?? 1); i++) {
      b.addOperation(
        opts.payment
          ? Operation.payment({
              destination: USDC.issuer,
              asset: Asset.native(),
              amount: '1',
            })
          : Operation.changeTrust({
              asset: opts.asset ?? new Asset('USDC', USDC.issuer),
              ...(opts.limit ? { limit: opts.limit } : {}),
            })
      )
    }
    const tx = b.setTimeout(300).build()
    if (opts.signer !== null) tx.sign(opts.signer ?? source)
    return tx.toXDR()
  }

  const expected = (passphrase = Networks.PUBLIC) => ({
    passphrase,
    usdc: USDC,
    source: kp.publicKey(),
  })

  function codeOf(xdr: string, exp = expected()): string {
    try {
      assertSignedChangeTrust(xdr, exp)
      return 'ok'
    } catch (e) {
      return e instanceof SignedTxError ? e.code : String(e)
    }
  }

  it('accepts the USDC ChangeTrust signed by the session account', () => {
    expect(codeOf(signed())).toBe('ok')
  })

  it('names a transaction signed for the other network', () => {
    expect(codeOf(signed({ passphrase: Networks.TESTNET }))).toBe(
      'wrong-network'
    )
    expect(codeOf(signed(), expected(Networks.TESTNET))).toBe('wrong-network')
  })

  it('refuses any other shape', () => {
    expect(
      codeOf(
        signed({
          asset: new Asset(
            'USDC',
            'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
          ),
        })
      )
    ).toBe('asset')
    expect(codeOf(signed({ ops: 2 }))).toBe('operations')
    expect(codeOf(signed({ payment: true }))).toBe('operation')
    expect(codeOf(signed({ limit: '0' }))).toBe('operation')
    expect(codeOf(signed({ limit: '1' }))).toBe('operation')
    expect(codeOf(signed({ limit: '0.0000001' }))).toBe('operation')
    expect(codeOf(signed({ source: Keypair.random() }))).toBe('source')
    expect(codeOf(signed({ signer: null }))).toBe('unsigned')
    expect(codeOf(signed({ signer: Keypair.random() }))).toBe('bad-signature')
    expect(codeOf('not-xdr')).toBe('parse')
  })

  it('refuses a fee-bump envelope', () => {
    const inner = TransactionBuilder.fromXDR(
      signed(),
      Networks.PUBLIC
    ) as Transaction
    const bump = TransactionBuilder.buildFeeBumpTransaction(
      kp,
      '200',
      inner,
      Networks.PUBLIC
    )
    bump.sign(kp)
    expect(codeOf(bump.toXDR())).toBe('fee-bump')
  })
})

describe('isChangeTrustBy', () => {
  const kp = Keypair.random()
  const HASH = 'cd'.repeat(32)
  const changeTrust = () => {
    const tx = new TransactionBuilder(new Account(kp.publicKey(), '100'), {
      fee: BASE_FEE,
      networkPassphrase: Networks.PUBLIC,
    })
      .addOperation(
        Operation.changeTrust({
          asset: new Asset('USDC', USDC.issuer),
          limit: MAX_TRUSTLINE_LIMIT,
        })
      )
      .setTimeout(300)
      .build()
    tx.sign(kp)
    return tx.toXDR()
  }
  const check = (fetchFn: typeof fetch) =>
    isChangeTrustBy(HASH, kp.publicKey(), {
      horizonUrl: 'https://horizon.example',
      passphrase: Networks.PUBLIC,
      usdc: USDC,
      fetchFn,
    })
  const answering = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }))

  it('confirms a successful USDC ChangeTrust from the address', async () => {
    const fetchFn = answering({
      successful: true,
      source_account: kp.publicKey(),
      envelope_xdr: changeTrust(),
    })
    expect(await check(fetchFn as unknown as typeof fetch)).toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(
      `https://horizon.example/transactions/${HASH}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('says false for an unknown or failed transaction', async () => {
    expect(await check(answering({}, 404) as unknown as typeof fetch)).toBe(
      false
    )
    expect(
      await check(
        answering({
          successful: false,
          source_account: kp.publicKey(),
          envelope_xdr: changeTrust(),
        }) as unknown as typeof fetch
      )
    ).toBe(false)
  })

  it('says false, never throws, when Horizon times out', async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    expect(await check(fetchFn as unknown as typeof fetch)).toBe(false)
  })

  it('says false, never throws, on a body that is not JSON', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 200 })
    )
    expect(await check(fetchFn as unknown as typeof fetch)).toBe(false)
  })
})

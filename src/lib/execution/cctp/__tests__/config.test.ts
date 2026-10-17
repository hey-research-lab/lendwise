import { StrKey } from '@stellar/stellar-sdk'
import { getAddress } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  STELLAR_CCTP_DOMAIN,
  cctpConfig,
  cctpSourceChain,
  cctpSourceChainBySlug,
  evmTxUrl,
} from '../config'

afterEach(() => vi.unstubAllEnvs())

describe('cctpConfig', () => {
  it('pins Stellar to CCTP domain 27, never a chain id', () => {
    expect(STELLAR_CCTP_DOMAIN).toBe(27)
  })

  it('freezes the mainnet source chains', () => {
    const c = cctpConfig('mainnet')
    expect(c.irisBaseUrl).toBe('https://iris-api.circle.com')
    expect(
      c.sourceChains.map((s) => [
        s.chainId,
        s.slug,
        s.domain,
        s.usdc,
        s.tokenMessengerV2,
      ])
    ).toEqual([
      [
        1,
        'ethereum',
        0,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
      ],
      [
        8453,
        'base',
        6,
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
      ],
      [
        42161,
        'arbitrum',
        3,
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
      ],
      [
        10,
        'optimism',
        2,
        '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
      ],
    ])
    expect(c.stellar).toEqual({
      tokenMessengerMinter:
        'CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL',
      messageTransmitter:
        'CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV',
      forwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
    })
  })

  it('freezes the testnet source chains', () => {
    const c = cctpConfig('testnet')
    expect(c.irisBaseUrl).toBe('https://iris-api-sandbox.circle.com')
    expect(
      c.sourceChains.map((s) => [
        s.chainId,
        s.slug,
        s.domain,
        s.usdc,
        s.tokenMessengerV2,
      ])
    ).toEqual([
      [
        11155111,
        'ethereum',
        0,
        '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
      ],
      [
        84532,
        'base',
        6,
        '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
      ],
      [
        421614,
        'arbitrum',
        3,
        '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
      ],
    ])
    expect(c.stellar).toEqual({
      tokenMessengerMinter:
        'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
      messageTransmitter:
        'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
      forwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
    })
  })

  it('stores checksummed EVM addresses and valid Stellar contract ids', () => {
    for (const network of ['mainnet', 'testnet'] as const) {
      const c = cctpConfig(network)
      for (const s of c.sourceChains) {
        expect(getAddress(s.usdc)).toBe(s.usdc)
        expect(getAddress(s.tokenMessengerV2)).toBe(s.tokenMessengerV2)
      }
      for (const id of Object.values(c.stellar)) {
        expect(StrKey.isValidContract(id)).toBe(true)
      }
    }
  })

  it('never resolves a chain of the other network', () => {
    expect(cctpSourceChain(8453, 'testnet')).toBeNull()
    expect(cctpSourceChain(84532, 'mainnet')).toBeNull()
    expect(cctpSourceChain(137, 'mainnet')).toBeNull() // Polygon: not a bridge source
    expect(cctpSourceChain(84532, 'testnet')?.name).toBe('Base Sepolia')
  })

  it('resolves slugs per network and refuses unknown ones', () => {
    expect(cctpSourceChainBySlug('base', 'mainnet')?.chainId).toBe(8453)
    expect(cctpSourceChainBySlug('base', 'testnet')?.chainId).toBe(84532)
    expect(cctpSourceChainBySlug('optimism', 'testnet')).toBeNull()
    expect(cctpSourceChainBySlug('lido', 'mainnet')).toBeNull()
    expect(cctpSourceChainBySlug('stellar', 'mainnet')).toBeNull()
  })

  it('follows the deployment network when none is given', () => {
    vi.stubEnv('NEXT_PUBLIC_NETWORK', 'testnet')
    expect(cctpConfig().network).toBe('testnet')
    vi.stubEnv('NEXT_PUBLIC_NETWORK', 'mainnet')
    expect(cctpConfig().network).toBe('mainnet')
  })

  it('links a hash to its chain explorer', () => {
    const base = cctpSourceChain(8453, 'mainnet')!
    expect(evmTxUrl(base, '0xabc')).toBe('https://basescan.org/tx/0xabc')
    const sepolia = cctpSourceChain(11155111, 'testnet')!
    expect(evmTxUrl(sepolia, '0xabc')).toBe(
      'https://sepolia.etherscan.io/tx/0xabc'
    )
  })
})

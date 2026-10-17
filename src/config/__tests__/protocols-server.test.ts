import { describe, expect, it } from 'vitest'

import { stellarPositionAdapters } from '../protocols-server'

describe('stellarPositionAdapters', () => {
  it('reads no protocol positions on a testnet deployment', () => {
    // Blend v2.1 pools are pubnet contracts; a testnet account has none.
    expect(
      stellarPositionAdapters({
        NEXT_PUBLIC_NETWORK: 'testnet',
        STELLAR_RISK_FIXTURE_ADDRESS:
          'GDHYIHAZ5URVB5TUKLREMPFGH4AYMIMON5KHXKKNYLTYGLUECF4OKV33',
      })
    ).toEqual({})
  })
})

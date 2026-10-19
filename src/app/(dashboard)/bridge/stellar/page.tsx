import { BridgeWidget } from '@/components/bridge'
import { protocolDisplayName } from '@/config/protocols-meta'
import { stellarNetworkId } from '@/config/stellar-network'
import { findProductById } from '@/lib/db/repositories/products'
import { formatUsdcAmount, maxBridgeAmount } from '@/lib/execution/cctp/amounts'
import { parseBridgeParams } from '@/lib/execution/cctp/deep-link'
import { isBridgeEnabled } from '@/lib/execution/cctp/kill-switch'
import { adapterId, productLink } from '@/lib/products/from-catalogue'

/** Server actions invoked from this page inherit this limit (seconds). */
export const maxDuration = 60

/** The Supply page reads no network param in the URL, so the fallback is unfiltered. */
const SUPPLY_FALLBACK = { venue: 'Stellar', href: '/supply' }

/**
 * "Next step" for a `product` deep link. An unknown product, a venue with no
 * link or a failed read degrades to the Supply page: the bridge never fails on it.
 */
async function resolveNextStep(
  productId: string | null
): Promise<{ venue: string; href: string } | null> {
  if (!productId) return null
  try {
    const row = await findProductById(productId)
    if (!row) return SUPPLY_FALLBACK
    const href = productLink(row)
    if (!href) return SUPPLY_FALLBACK
    return { venue: protocolDisplayName(adapterId(row)), href }
  } catch (err) {
    console.error('[bridge] product lookup failed', err)
    return SUPPLY_FALLBACK
  }
}

export default async function BridgeStellarPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // Read per request: awaiting `searchParams` makes this page dynamic.
  const params = parseBridgeParams(await searchParams)
  const network = stellarNetworkId()
  const cap = maxBridgeAmount(network, process.env)
  return (
    <div className="mx-auto w-full max-w-[480px] px-4 py-8">
      <BridgeWidget
        network={network}
        enabled={isBridgeEnabled(network, process.env)}
        cap={cap === null ? null : formatUsdcAmount(cap)}
        initialAmount={params.amount}
        linkAmountInvalid={params.amountInvalid}
        initialSourceChainId={params.source?.chainId ?? null}
        productId={params.productId}
        nextStep={await resolveNextStep(params.productId)}
      />
    </div>
  )
}

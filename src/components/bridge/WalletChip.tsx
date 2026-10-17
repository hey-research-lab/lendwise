'use client'

import Image from 'next/image'

import { useAccountModal, useConnectModal } from '@rainbow-me/rainbowkit'
import { ChevronRight, Copy, ExternalLink, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'

import { NetworkIcon } from '@/components/icon/NetworkIcon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatAddress } from '@/lib/utils'

const CHIP =
  'text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline'

/** Pay: connects the EVM wallet, then shows it and opens RainbowKit's account window. */
export function EvmWalletChip() {
  const { address, connector } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { openAccountModal } = useAccountModal()
  if (!address) {
    return (
      <button
        type="button"
        className={CHIP}
        onClick={() => openConnectModal?.()}
      >
        <Wallet className="size-4" />
        Connect wallet
        <ChevronRight className="size-3" />
      </button>
    )
  }
  return (
    <button
      type="button"
      className={CHIP}
      title={address}
      onClick={() => openAccountModal?.()}
    >
      {connector?.icon ? (
        <Image
          src={connector.icon}
          alt=""
          width={16}
          height={16}
          unoptimized
          className="rounded-sm"
        />
      ) : (
        <Wallet className="size-4" />
      )}
      {formatAddress(address)}
      <ChevronRight className="size-3" />
    </button>
  )
}

/**
 * Receive: the signed-in Stellar account, or the way to sign in. Switching
 * accounts stays in the navbar: a second sign-in path here could set the
 * account on screen apart from the session cookie.
 */
export function StellarWalletChip({
  address,
  explorerUrl,
  onSignIn,
}: {
  address: string | null
  explorerUrl: string
  onSignIn: () => void
}) {
  if (!address) {
    return (
      <button type="button" className={CHIP} onClick={onSignIn}>
        <Wallet className="size-4" />
        Select recipient
        <ChevronRight className="size-3" />
      </button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={CHIP} title={address}>
          <NetworkIcon networkSlug="stellar" size={16} />
          {formatAddress(address)}
          <ChevronRight className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard
              .writeText(address)
              .then(() => toast.success('Address copied'))
          }}
        >
          <Copy className="size-4" />
          Copy address
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={`${explorerUrl}/account/${address}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="size-4" />
            View on Stellar Expert
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

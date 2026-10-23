'use client'

import type { ReactNode } from 'react'

import Image from 'next/image'

import { ArrowUpRight, X } from 'lucide-react'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { stellarWalletSections } from '@/lib/wallet/stellar-wallets'

/** What the picker needs from the kit's supported-wallet list. */
export interface PickerWallet {
  id: string
  name: string
  isAvailable: boolean
}

/**
 * The Stellar wallet list, drawn like RainbowKit's EVM modal (measured on
 * RainbowKit 2.2, borderRadius "medium"): 370px wide, 16px corners, a round
 * 28px close button, 40px rows with 28px icons that light up on hover and
 * press in on click. The Stellar Wallets Kit only supplies the wallets.
 */
export function StellarWalletPicker({
  open,
  wallets,
  usedIds,
  onSelect,
  onClose,
}: {
  open: boolean
  /** Null while the kit checks which wallets are installed. */
  wallets: readonly PickerWallet[] | null
  /** The kit's recent-wallets record, newest first. */
  usedIds: readonly string[]
  onSelect: (wallet: PickerWallet) => void
  onClose: () => void
}) {
  const sections = wallets && stellarWalletSections(wallets, usedIds)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="bg-popover text-popover-foreground w-[370px] max-w-[calc(100%-2rem)] gap-0 rounded-2xl p-0 shadow-[0_8px_32px_rgba(0,0,0,0.32)] sm:max-w-[370px]"
      >
        <div className="relative px-[18px] pt-[19px] pb-2">
          <DialogTitle className="text-center text-lg leading-6 font-extrabold">
            Connect a Wallet
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose the Stellar wallet to sign in with.
          </DialogDescription>
          <DialogClose
            aria-label="Close"
            className="bg-muted text-muted-foreground absolute top-[17px] right-[17px] flex size-7 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110 active:scale-90"
          >
            <X className="size-3.5" strokeWidth={3} />
          </DialogClose>
        </div>

        <div className="px-[18px] pb-[18px]">
          {sections === null ? (
            <p className="text-muted-foreground py-6 text-center text-sm font-medium">
              Looking for wallets…
            </p>
          ) : (
            <>
              {sections.available.length > 0 && (
                <Section title="Available" accent>
                  {sections.available.map(({ wallet, recent }) => (
                    <WalletRow
                      key={wallet.id}
                      wallet={wallet}
                      recent={recent}
                      onSelect={onSelect}
                    />
                  ))}
                </Section>
              )}
              {sections.toInstall.length > 0 && (
                <Section title="Get a wallet">
                  {sections.toInstall.map((wallet) => (
                    <WalletRow
                      key={wallet.id}
                      wallet={wallet}
                      onSelect={onSelect}
                    />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-6 pt-5 pb-[18px] text-sm">
          <span className="text-muted-foreground font-medium">
            New to Stellar wallets?
          </span>
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-bold transition-transform duration-150 hover:scale-105 active:scale-95"
          >
            Get Freighter
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({
  title,
  accent = false,
  children,
}: {
  title: string
  accent?: boolean
  children: ReactNode
}) {
  return (
    <section className="mt-4">
      <h2
        className={`mb-2 pl-1.5 text-sm font-bold ${accent ? 'text-primary' : 'text-muted-foreground'}`}
      >
        {title}
      </h2>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  )
}

/** A wallet: connects when it is usable, opens its install page otherwise. */
function WalletRow({
  wallet,
  recent = false,
  onSelect,
}: {
  wallet: PickerWallet
  recent?: boolean
  onSelect: (wallet: PickerWallet) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(wallet)}
      aria-label={wallet.isAvailable ? undefined : `Install ${wallet.name}`}
      className="hover:bg-accent flex min-h-10 w-full items-center gap-3 rounded-lg p-[5px] text-left transition-[background-color,transform] duration-150 active:scale-95"
    >
      <Image
        src={`/wallets/${wallet.id}.png`}
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0 rounded-md"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-bold">{wallet.name}</span>
        {recent && (
          <span className="text-primary text-xs leading-none font-semibold">
            Recent
          </span>
        )}
      </span>
      {!wallet.isAvailable && (
        <ArrowUpRight className="text-muted-foreground size-4 shrink-0" />
      )}
    </button>
  )
}

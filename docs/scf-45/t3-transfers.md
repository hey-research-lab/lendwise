# SCF #45 Tranche 3 — bridge transfers used as evidence

Every transfer below is a row of `bridge_transfers`, written by the server at each step.
Amounts in USDC; `received` is read from the mint transaction's events.

| Date (UTC)       | Network | Source           | Journey        | Amount | Circle fee | Received | ChangeTrust                                                                                                              | Approval                                                                                                          | Burn                                                                                                              | Iris nonce    | Mint                                                                                                                     |
| ---------------- | ------- | ---------------- | -------------- | ------ | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-16 18:59 | testnet | Base Sepolia     | new user       | 2      | 0.00026    | 1.99974  | [0f8e65b0…](https://stellar.expert/explorer/testnet/tx/0f8e65b0990d0e24098e6bc9d3e42d11d1723b1fb1b1a9d94ff5cf1ad3a7a2b2) | [0x48cc8991…](https://sepolia.basescan.org/tx/0x48cc8991af041e921a7395f3c9e7ea2a7a7e2c9f3c8c5608b34e5285312b7bf3) | [0x615f306d…](https://sepolia.basescan.org/tx/0x615f306d86302c3925d525ef3e2aa53a6f9309d3f29db739c42dd3f9a5f9cac7) | `0x9940a613…` | [3fac8bcc…](https://stellar.expert/explorer/testnet/tx/3fac8bccbb096613558290dbfb7fdee46cfb8629c9c5d6a4fd3f66d1ed6f264e) |
| 2026-10-16 21:21 | testnet | Ethereum Sepolia | returning user | 1      | 0.0001     | 0.9999   | —                                                                                                                        | [0xdcfb3bd8…](https://sepolia.etherscan.io/tx/0xdcfb3bd8013ba734466ca83227607a53fd4010052e838a35a0930340e74c45bd) | [0xc4993bf4…](https://sepolia.etherscan.io/tx/0xc4993bf48d2d353bb75327b2b337a7913978381fb43a2847bbe9ab04320f3ee3) | `0x88901e73…` | [8ca47b9f…](https://stellar.expert/explorer/testnet/tx/8ca47b9fcf8934c1955efbbffe668bcea5e46e59b35983ade89e012a8dab2cd5) |
| 2026-10-19 00:04 | mainnet | Base             | returning user | 5      | 0.00065    | 4.99935  | —                                                                                                                        | [0x824c1955…](https://basescan.org/tx/0x824c1955d45e0e69509ea666b7dafcb91dda4a38a9fbbb8097242507d8af1b35)         | [0x42878875…](https://basescan.org/tx/0x428788758cde10c635110abfc8c84fb800d76a8995254f73a0922a90c1945ac0)         | `0x6d3dde0a…` | [64717907…](https://stellar.expert/explorer/public/tx/64717907a20683eca1b62b8852252a02cb43caadbbdb71a73613e5e692266d50)  |

All three rows have status `completed` and no error, and in all three
`minted_amount = (amount − fee_executed) × 10`: USDC has 6 decimals on the EVM side and 7 on
Stellar.

## Where they ran

- **App:** [testnet.lendwise.fi/bridge/stellar](https://testnet.lendwise.fi/bridge/stellar), the
  `testnet` branch deployment (Stellar testnet, Neon branch `staging-testnet`).
- **Commits:** transfer 1 on `9a6fe42` (PR #34). Transfer 2 on `612b63c` (PR #37, which pinned
  public RPCs for the testnet chains). That deployment was ready at 21:20:37 UTC, before
  transfer 2 started at 21:21:18 UTC.
- **Accounts:** Stellar
  [`GBGGQPLRYAPGBA7JKNOWSQQVDCV23M6UBUWVULBBOZ6GPR4U5UE2BYL7`](https://stellar.expert/explorer/testnet/account/GBGGQPLRYAPGBA7JKNOWSQQVDCV23M6UBUWVULBBOZ6GPR4U5UE2BYL7)
  in Freighter, and EVM `0xE6ebFf6b69A58CfBa089DEB1c47a4Dc87C83Fbcc` in MetaMask.

## Transfer 1: new user

The Stellar account did not exist when the transfer started.

1. **Sign-in:** the Stellar sign-in worked with the unfunded account.
2. **Funding:** the bridge page reported that the account did not exist yet and offered
   Friendbot.
   [Friendbot created it](https://stellar.expert/explorer/testnet/tx/0c748d936b2d0fbe6049493374e706989a58167e7abc444d0f9845bfe2c24a23)
   at 18:56:12 UTC.
3. **USDC prompt:** the page then asked to add USDC to the Stellar wallet, with the bridge button
   disabled ([`t3-testnet-trustline-prompt.png`](t3-testnet-trustline-prompt.png)).
4. **ChangeTrust:** signed in Freighter at 18:58:52 UTC, with the maximum limit.
5. **Approval and burn:** both on Base Sepolia.
6. **Resume:** the page was reloaded while the transfer was in progress. "Your transfers" listed
   it as attested, with **Resume** ([`t3-testnet-resume.png`](t3-testnet-resume.png)).
7. **Mint:** signed in Freighter. The page showed the transfer done with the four transaction
   links ([`t3-testnet-done.png`](t3-testnet-done.png)).
8. **Portfolio:** the received USDC appears under "Wallet balances", next to the account's XLM
   ([`t3-testnet-portfolio.png`](t3-testnet-portfolio.png)). The EVM rows on that tab are the same
   address's mainnet balances: on testnet, only the Stellar side and the bridge's source chains
   switch network.

**MetaMask paid the gas (EIP-7702).** In transfer 1, MetaMask offered its gasless mode and
upgraded the account to a smart account. On Basescan, the approval and the burn are therefore
sent by MetaMask relayers to MetaMask's contract, not by `0xE6eb…Fbcc`. The burn is still the
user's:

- the `DepositForBurn` event names `0xE6eb…Fbcc` as depositor;
- Circle's message names it as `messageSender`.

The server checks the burn against the depositor, not the transaction's `from`, so it accepted
the burn. Transfer 2, on Sepolia, used plain transactions from `0xE6eb…Fbcc`.

## Transfer 2: returning user

Same Stellar account, which already had the USDC trustline, so no ChangeTrust was needed:

- the row's `change_trust_tx_hash` is empty;
- the trustline step shows no transaction.

The captures:

- [`t3-testnet-attestation.png`](t3-testnet-attestation.png): the wait for Circle's attestation,
  47 seconds in;
- [`t3-testnet-returning.png`](t3-testnet-returning.png): the completed transfer.

## Transfer 3: mainnet

- **App:** [mainnet.lendwise.fi/bridge/stellar](https://mainnet.lendwise.fi/bridge/stellar), the
  `mainnet` branch deployment (Stellar mainnet, production database). The bridge was opened for
  that branch only (`CCTP_BRIDGE_ENABLED=1`); lendwise.fi still had it paused.
- **Accounts:** Stellar
  [`GDHYIHAZ5URVB5TUKLREMPFGH4AYMIMON5KHXKKNYLTYGLUECF4OKV33`](https://stellar.expert/explorer/public/account/GDHYIHAZ5URVB5TUKLREMPFGH4AYMIMON5KHXKKNYLTYGLUECF4OKV33)
  in Freighter, which already had the USDC trustline, and EVM
  `0xb09303f65801e1d995f7f3838ae60a3d3b0a3f28` in MetaMask.
- **Approval, burn and attestation** ran on `2dd56ef` (PR #43). As in transfer 1, MetaMask paid the
  gas: the burn is sent by a MetaMask relayer, and its `DepositForBurn` event names
  `0xb093…3f28` as depositor, for 5,000,000 units to domain 27. Circle attested it as Fast, with a
  fee of 650 units (1.3 bps).

**The mint took three signatures.** On mainnet the server's Soroban RPC is dRPC; on testnet it is
the public one, so this was the first transaction the server sent through dRPC. dRPC answered both
first submissions with HTTP 500:

| Signed at (UTC) | Mint transaction | What happened                                                         |
| --------------- | ---------------- | --------------------------------------------------------------------- |
| 00:06           | `24c9ae79…`      | HTTP 500 from dRPC; never on the network (`NOT_FOUND`, Horizon 404)   |
| 00:14           | `1a8873fd…`      | Same                                                                  |
| 00:27           | `64717907…`      | HTTP 500 from dRPC, resent through the public RPC; in ledger 65016777 |

Each time, the server could not tell whether the transaction had left, so the transfer waited out
the transaction's five-minute validity window, then asked for a new signature. PR #44 (deployed in
`c0d9b31`, PR #45) resends the same signed transaction through the network's public Soroban RPC
when the provider gives no answer. The third mint went through it.

**Checked on the chain.** The mint's balance changes on Horizon:

- Circle's minter mints 4.99935 USDC to the forwarder `CBZL2IH7…JDF5T`, and 0.00065 USDC to the
  CCTP fee recipient `GBICEF24…`;
- the forwarder transfers the 4.99935 USDC to `GDHYIH…KV33`.

That is `(5,000,000 − 650) × 10 = 49,993,500` Stellar units, the row's `minted_amount`. The mint's
fee was 0.0282 XLM.

The capture: [`t3-mainnet-complete.png`](t3-mainnet-complete.png).

## Testnet transfers checked against the chains

Each transfer was checked against Base Sepolia or Sepolia, Circle's Iris sandbox and Stellar
testnet. Both are Fast transfers (finality threshold 1000), and both Iris messages are `complete`.

- **Amount received:** what the mint's USDC transfer event pays the account equals
  `(amount − fee) × 10`.
- **Message:**
  - the hook carried by Circle's message decodes to the Stellar account;
  - it is byte for byte what LendWise's burn builds for that account;
  - the mint call carries the exact message and attestation Iris served.
- **Expiry:** each message was minted with about 17,250 ledgers (about a day) to spare.

| Transfer | Burn confirmed | Mint     | Burn → mint                                        | Mint fee charged |
| -------- | -------------- | -------- | -------------------------------------------------- | ---------------- |
| 1        | 19:01:50       | 19:04:17 | 2 min 27 s, including a page reload to test Resume | 0.0125839 XLM    |
| 2        | 21:22:00       | 21:22:52 | 52 s                                               | 0.0125441 XLM    |

After both transfers, the account holds 2.99964 USDC.

The two Iris messages are also CI fixtures, beside two third-party testnet mints, in
`src/lib/execution/cctp/__tests__/testnet-mints.test.ts` (PR #36).

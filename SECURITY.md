# Security Policy

Lendwise compares lending rates across DeFi protocols. It never holds user funds and never
asks for private keys. A connected wallet is only asked to sign, and shows each request
before signing:

- a SEP-10 challenge, to sign in with a Stellar account. The challenge is never submitted
  to the network;
- the transactions of the USDC bridge (Circle CCTP, EVM → Stellar): the USDC approval and
  burn on the source chain, then the trustline and the mint on Stellar.

We take the security of the application and its infrastructure (APIs, sign-in, database,
rate limiting, data integrity) seriously.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through either channel:

- **GitHub**: [Report a vulnerability](https://github.com/lendwise-fi/lendwise/security/advisories/new) (preferred)
- **Email**: [hello@lendwise.fi](mailto:hello@lendwise.fi) with `[SECURITY]` in the subject

Include as much detail as you can: affected endpoint or component, reproduction steps, and
potential impact.

## What to Expect

- **Acknowledgment** within 72 hours.
- **Assessment and fix timeline** communicated within 7 days.
- Credit in the release notes once the fix ships, if you want it.

## Scope

In scope:

- The web application and its API routes (`/api/graphql`, `/api/optimizer`, cron endpoints)
- Stellar sign-in (`/api/auth/stellar/*`): SEP-10 challenges, the session cookie, sign-out
- The USDC bridge: the transactions it builds for the wallet to sign, and the transfer
  records behind them
- Data-integrity issues in the APY pipeline (poisoning, injection)
- Authentication/authorization bypasses on protected endpoints

Out of scope:

- Vulnerabilities in the underlying protocols and networks (Aave, Morpho, Compound, Blend,
  Circle CCTP, Stellar) — report those to the respective teams
- Vulnerabilities in wallet software (MetaMask, Freighter, …)
- Rate-limit findings that require unrealistic volumes
- Social engineering, physical attacks

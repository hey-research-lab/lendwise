# SCF #45 Tranche 3 — reconcile run on an isolated staging

The nightly reconcile reports each chain family: which adapters it checked, the holes it found,
and how each one was repaired (refetch from history, a neighbouring hour, or no donor). This run
shows the Stellar family — Blend v2.1 and the Stellar fixture — checked in the same run as the
EVM family, with every Stellar hole repaired from Stellar Hubble history.

| File                                                                           | What it is                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`t3-reconcile-staging.txt`](t3-reconcile-staging.txt)                         | `pnpm reconcile:status` for the report of run 2                           |
| [`t3-reconcile-staging-families.json`](t3-reconcile-staging-families.json)     | The `families` section of the same `pipeline_reports` row                 |
| [`t3-reconcile-staging-budget-cap.json`](t3-reconcile-staging-budget-cap.json) | Run 1: the same run with the default Hubble cost cap, refused by BigQuery |

## Setup

- **Database:** Neon branch `reconcile-demo`, copied from production and reset to it just before
  each run. Collectors write only to production, so the branch receives no new rows after the
  reset: the only holes are the ones made on purpose below.
- **App:** a preview of the git branch `staging/reconcile-demo`, running the code of `mainnet` at
  `ee05926` (PR #41). The deployed commits `a03265b` and `6c3a3bd` are empty commits that only
  trigger a deployment.
- **Variables scoped to that branch:**
  - the branch's database URLs;
  - `STELLAR_YIELD_FIXTURE=1`, which registers the fixture's yield face (never in production,
    whatever the variable says);
  - for run 2 only, `HUBBLE_MAX_BYTES_BILLED=644245094400` (600 GiB), the value used for the
    Tranche 1 history files.
- **Calls:** signed QStash requests, as in production.

## Run 2 (2026-10-17, UTC)

| Time        | Step                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| 22:54       | Branch reset on production                                                                                |
| 22:54:25    | Catalogue sync of the fixture (`/api/yield/products`): product `stellar:fixture:stellar:reserve:…:supply` |
| 22:55:56    | Spot collection (`/api/yield/apy/spot`): one row at 22:00, `apy_net` 0.075                                |
| 23:00–23:01 | Holes made: see below                                                                                     |
| 23:01:17    | Reconcile (`/api/yield/apy/reconcile`, 7 days)                                                            |
| 23:02:53    | Report row `ed693236-26fe-4c19-9f0e-6c5572c752d4`, after 94 s                                             |

The holes:

- **Fixture:** its availability period was back-dated 72 hours. The reconcile therefore owed it
  every hour from 2026-10-14 23:00 to 2026-10-17 22:00.
- **Blend v2.1, Fixed pool, USDC supply:** six hours deleted, 2026-10-16 17:00 to 22:00.

```text
reconcile report ed693236-26fe-4c19-9f0e-6c5572c752d4 — 2026-10-17T23:02:53.573Z
window 2026-10-10T23:00:00.000Z → 2026-10-17T23:00:00.000Z · success true · dryRun false
family    gaps  refetch  neighbour  no donor  history req/ret/fail  adapters
evm          0        0          0         0                 0/0/0  aave_v3 (history), morpho_v1 (history), compound_v3 (history)
stellar     78       78          0         0                 2/2/0  blend_v2.1 (history), stellar_fixture (history)
```

- **78 Stellar holes:**
  - Blend's 6 deleted hours;
  - the fixture's 72 owed hours: 71 missing, plus its 22:00 hour, which holds one collection
    instead of six (`detected.missing = 77`, `incomplete = 1`).
- **All 78 repaired by refetch.** The reconcile made one Hubble history query per adapter:
  - fixture: 256 `contract_data` rows;
  - Blend: 33 rows.
- **EVM family:** Aave, Morpho and Compound were checked in the same run and had no hole.

## What Hubble refetch costs

Each history query reads `contract_data` back to Blend's launch, to seed each storage key's value
before the window. That scan costs about 546 GiB whatever the window, as the Tranche 1 history
files already showed ([`docs/data/stellar-history/README.md`](../data/stellar-history/README.md)).
In run 2, the function logs report 547.92 GiB billed for the fixture and 546.02 GiB for Blend,
1.07 TiB in total.

**Run 1** used the same setup one hour earlier, with the default cap of 20 GiB:

- reset at 21:55, spot at 21:58, reconcile report `9741d145-2e44-46b5-8cc1-9ff77cdacff0` at
  22:04:25;
- the same 78 holes were found;
- BigQuery refused both history queries: `Query exceeded limit for bytes billed: 21474836480.
588237504512 or higher required`;
- the reconcile fell back: 12 hours from a neighbouring hour, 66 with no donor.

**Production keeps the 20 GiB default.** There, a Stellar hole is repaired from a donor, not from
Hubble, as the cost guard in
[`docs/architecture-stellar-integration.md`](../architecture-stellar-integration.md) describes.
Hubble refetch on every nightly run would need a cheaper seed. This tranche does not change that.

## Teardown

After the capture, the branch-scoped variables, the git branch, the two demo deployments and the
Neon branch were deleted.

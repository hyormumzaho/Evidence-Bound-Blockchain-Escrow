# Experiments

`pnpm experiment:small` and `pnpm experiment:full` start a private Anvil on `127.0.0.1:8546`, deploy the three escrow contracts, and write mined-transaction measurements.

```bash
pnpm experiment:small
pnpm experiment:full
```

Small suite: submission at 1, 5, and 10 artifacts for each strategy, plus acceptance and one arbitration split.

Full suite: submission at 1, 2, 5, 10, 20, 50, and 100 artifacts, with the same lifecycle transactions.

Results:

- `experiments/results/raw/<run-id>.json` keeps each run.
- `experiments/results/latest.json` is the file the web Measurements page reads.

Gas values are `gasUsed` from transaction receipts. Preparation timings are off-chain, with one warmup excluded, and are reported as median and p95 over 20 trials. The artifact bytes are synthetic and labeled as such. Do not add rows by hand.

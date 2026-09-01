# Contributing

## This repository is a one-way mirror

The source of truth for this package is `packages/demo/` in the Thskyshield
control-plane repository. Every commit here is written by a sync script
(`scripts/mirror-demo.ts` upstream), which replaces the tree wholesale from
the upstream directory.

The practical consequence, stated plainly because it is the kind of thing
that wastes an afternoon: **a pull request merged into this repo would be
erased by the next sync.** Nothing here is lost quietly — it is lost loudly,
on the next push, with no warning to whoever wrote it.

So:

- **Issues — yes, here.** [Open one.](https://github.com/Thsky-21/demo/issues)
  Bugs, a confusing kill message, a scenario that doesn't match the README.
  This is the right place and it is read.
- **Pull requests — open one anyway if it is easier than describing the
  change in prose.** It will be read and it will be applied upstream. It will
  reach this repo as part of a sync commit rather than as your commit, and
  the PR itself will be closed rather than merged. That is not a comment on
  the patch; it is the only shape the mirror allows. Attribution goes in the
  changelog.
- **Security reports — do not open an issue.** Use the contact form at
  [thskyshield.com/contact](https://www.thskyshield.com/contact), which
  reaches a person directly. Say "security" in the message so it is not read
  as a sales enquiry.

## Why it is mirrored rather than developed here

`engine.ts` is a port of the same before-step/after-step decision logic that
production runs as Lua inside Redis, and `pricing.ts` is a vendored copy of
the production pricing registry. The tests that keep both honest —
`tests/demo-engine.test.ts` pinning the port against the Lua's documented
invariants, `tests/demo-pricing-parity.test.ts` pinning the vendored registry
against the production one, `tests/demo-output.test.ts` pinning the
captured CLI output the marketing site quotes — all live in the control-plane
repo, because half of each comparison is the production code, which is not
here. Development happens where both halves are; this repo is the readable,
runnable result.

CI here proves what this package can prove on its own: that it typechecks and
builds standalone, with nothing reached into an app that is not present.

## Running it

```bash
npx @thsky-21/thskyshield-demo
```

No signup, no API key, no network. See the README for what you'll see and
how honest the numbers are.

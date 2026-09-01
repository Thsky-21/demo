# @thsky-21/thskyshield-demo

Watch an AI agent loop, overspend, and get killed at a budget ceiling — in one command.

```bash
npx @thsky-21/thskyshield-demo
```

No signup. No API key. No network. Takes about 4 seconds.

## What you'll see

An agent gets stuck retrying the same failing prompt. Each step costs real
`gpt-4o` money. The loop detector counts the repeats climbing while the spend
bar fills, and at `$0.05` the next step is denied **before the model is called**:

```
  step 15  allowed  cost $0.003250  total $0.048750  ████████████  98%
           ↳ loop detector: identical prompt ×15 of 20

  KILLED  step 16  —  budget ceiling reached
  The step was denied before the model was called. $0.048750 of $0.05 spent — the ceiling held.

  Total spend      $0.048750 of $0.05
  Steps allowed    15
  Killed by        budget
  Time to kill     3436 ms from run start
  Prevented        unbounded spend — at $0.003250 per step, forever
```

## How honest is this?

Worth being precise, because a demo that flatters itself isn't worth running:

- **The costs are real.** Steps are priced from the same model-pricing registry
  production uses, not from numbers written into the demo.
- **The decisions are real.** The kill order, the off-by-one semantics, the
  integer-microdollar arithmetic, and the fact that a killed step never reserves
  (so a budget kill lands *under* the ceiling, at `$0.048750`, not over it) all
  match production and are pinned by tests.
- **The LLM call is simulated.** The demo doesn't need an OpenAI key. The
  governance decision around the call is the real thing either way.
- **The engine is a local port, not the engine.** In production the decision
  logic runs as Lua inside Redis — atomic and distributed. Here it runs in your
  process so the demo works with no account. Same decisions, different substrate.
- **"Prevented: unbounded" is not a dollar figure on purpose.** The agent has no
  stopping condition — no retry cap, no convergence check, no notion of its own
  cost. Any specific number would be invented, and far too small. Real,
  measured savings come from observe mode, which computes them from settled
  actuals on your own runs.

## The real thing

This demo governs a fake agent locally. To govern your actual agents:

```bash
npm install @thsky-21/thskyshield
```

```ts
import { Thskyshield } from '@thsky-21/thskyshield';

const shield = new Thskyshield({ siteId, apiKey });
const run = await shield.beginRun({ budgetLimitUsd: 2.00, loopThreshold: 5 });

const { requestId } = await run.beforeStep({
  stepType: 'llm',
  model: 'gpt-4o',
  promptInput: prompt,   // hashed client-side; raw prompt never leaves your process
});

// ... call your model ...

await run.afterStep({ requestId, actualTokens: usage, model: 'gpt-4o' });
```

Start free at **[thskyshield.com/start](https://thskyshield.com/start)** — no infra.

## License

MIT

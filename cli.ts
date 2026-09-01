#!/usr/bin/env node
/**
 * packages/demo/cli.ts — `npx @thsky-21/thskyshield-demo`
 *
 * Zero-login demo (Part 4). A stranger runs one command and watches an agent
 * loop, overspend, and get killed at a $0.05 ceiling. No signup, no API key, no
 * network — the decision logic runs locally via packages/demo/engine.ts.
 *
 * Based on scripts/runaway-agent.ts, which does the same thing against a real
 * deployment (and needs credentials). This is that demo with the control plane
 * inlined so it works for someone who has never heard of us.
 *
 * The scenario is tuned so BOTH signals are visible before the run dies:
 * the loop counter climbs toward its threshold (loop detection forming) while
 * the budget ceiling trips first. That is the honest shape of a real runaway —
 * usually the money runs out before the loop gate does.
 *
 * This package builds standalone (see pricing.ts's header) — every import
 * below resolves inside packages/demo, nothing reaches into the monorepo.
 */

import { DemoRun, type KillReason } from "./engine";
import { microdollarsToUsd, costToMicrodollars } from "./pricing";

// ─── SCENARIO ─────────────────────────────────────────────────────────────────

const BUDGET_USD      = 0.05;
const ITERATION_LIMIT = 50;
const LOOP_THRESHOLD  = 20;
const TIMEOUT_SECONDS = 300;
const MODEL           = "gpt-4o";
const STEP_TOKENS     = { input: 500, output: 200 };
const STEP_DELAY_MS   = 220; // paced for legibility, not throttling

// The agent is stuck: it retries the identical prompt forever, believing each
// attempt is fresh. This is what a real runaway looks like from the outside.
const STUCK_PROMPT =
  "Find the current CEO of Acme Corp. If unsure, try again with a better search.";

// ─── OUTPUT ───────────────────────────────────────────────────────────────────

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const c = {
  dim:    (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold:   (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  green:  (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  amber:  (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  red:    (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  cyan:   (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

const usd  = (md: number) => `$${microdollarsToUsd(md).toFixed(6)}`;
const rule = (ch = "─") => c.dim(ch.repeat(64));

/** Small inline meter: [████████░░░░] */
function meter(ratio: number, width = 12): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const paint = ratio >= 0.85 ? c.red : ratio >= 0.5 ? c.amber : c.green;
  return paint(bar);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KILL_COPY: Record<KillReason, string> = {
  killed_budget:          "budget ceiling reached",
  killed_loop:            "loop detected — identical prompt repeated",
  killed_iterations:      "iteration limit reached",
  killed_timeout:         "run exceeded its time limit",
  killed_scope_tool:      "tool not in this run's allowlist",
  killed_scope_mutation:  "step exceeded this run's mutation-class ceiling",
};

// ─── DEMO ─────────────────────────────────────────────────────────────────────

async function main() {
  const budgetMd = costToMicrodollars(BUDGET_USD);

  console.log("");
  console.log(c.bold("  Thskyshield — runaway agent demo"));
  console.log(c.dim("  An agent gets stuck in a retry loop. Watch it get killed."));
  console.log("");
  console.log(`  ${c.dim("Budget ceiling")}   ${c.bold(`$${BUDGET_USD.toFixed(2)}`)}`);
  console.log(`  ${c.dim("Iteration limit")}  ${ITERATION_LIMIT}`);
  console.log(`  ${c.dim("Loop gate")}        ${LOOP_THRESHOLD} identical prompts`);
  console.log(`  ${c.dim("Timeout")}          ${TIMEOUT_SECONDS}s`);
  console.log(`  ${c.dim("Model")}            ${MODEL} ${c.dim(`(${STEP_TOKENS.input} in / ${STEP_TOKENS.output} out per step)`)}`);
  console.log("");
  console.log(c.dim("  No account, no API key, no network — the governance engine"));
  console.log(c.dim("  runs locally in this process. Prices are the real registry."));
  console.log("");
  console.log(rule());
  console.log("");

  const run = new DemoRun({
    budgetMicrodollars: budgetMd,
    iterationLimit:     ITERATION_LIMIT,
    loopThreshold:      LOOP_THRESHOLD,
    timeoutMs:          TIMEOUT_SECONDS * 1000,
  });

  const startedAt = Date.now();
  let killed: KillReason | null = null;
  let killedAtStep = 0;
  let stepCostMd = 0;

  for (;;) {
    const decision = run.beforeStep({
      model:        MODEL,
      inputTokens:  STEP_TOKENS.input,
      outputTokens: STEP_TOKENS.output,
      fingerprint:  STUCK_PROMPT, // identical every step — the loop counter climbs
    });

    if (!decision.allowed) {
      killed = decision.status as KillReason;
      killedAtStep = decision.iteration;
      break;
    }

    // "Call the LLM." Simulated so the demo needs no LLM key; the governance
    // decision above is the real thing either way.
    await sleep(STEP_DELAY_MS);

    // Settle the actual cost. Estimate == actual here because the simulated call
    // returns exactly the tokens we estimated.
    const actualMd = run.afterStep({
      requestId:    decision.requestId,
      model:        MODEL,
      inputTokens:  STEP_TOKENS.input,
      outputTokens: STEP_TOKENS.output,
    });
    stepCostMd = actualMd;

    const spentMd     = run.totalSpentMicrodollars;
    const budgetRatio = spentMd / budgetMd;
    const loopCount   = decision.fpCount;

    const stepLabel = c.dim(`step ${String(decision.iteration).padStart(2, "0")}`);
    const line =
      `  ${stepLabel}  ${c.green("allowed")}  ` +
      `${c.dim("cost")} ${usd(actualMd)}  ` +
      `${c.dim("total")} ${c.bold(usd(spentMd))}  ` +
      `${meter(budgetRatio)} ${String(Math.round(budgetRatio * 100)).padStart(3)}%`;
    console.log(line);

    // Surface the loop detector forming, once it's a real signal.
    if (loopCount >= 2) {
      const loopRatio = loopCount / LOOP_THRESHOLD;
      const tone = loopRatio >= 0.5 ? c.amber : c.dim;
      console.log(
        `           ${tone(`↳ loop detector: identical prompt ×${loopCount} of ${LOOP_THRESHOLD}`)}`
      );
    }
  }

  const timeToKillMs = Date.now() - startedAt;
  const spentMd      = run.totalSpentMicrodollars;

  // What was prevented is deliberately NOT given a dollar figure.
  //
  // The tempting number — "it would have run N more steps to the loop gate, so
  // we saved N × step cost" — measures the product against itself: the loop gate
  // is also Thskyshield. Strip every limit out and this agent has no stopping
  // condition at all; it repeated one identical failing prompt and never
  // converged. The prevented amount is unbounded, and any specific figure would
  // be both fabricated and far too small. So we state the certain thing.
  //
  // (Real observed savings, computed from settled actuals rather than guessed,
  // are what observe mode and the dashboard's savings ledger are for.)

  console.log("");
  console.log(rule());
  console.log("");
  console.log(
    `  ${c.red(c.bold("KILLED"))}  ${c.red(`step ${killedAtStep}`)}  ${c.dim("—")}  ` +
    `${c.bold(KILL_COPY[killed!])}`
  );
  console.log(
    `  ${c.dim(`The step was denied before the model was called. ${usd(spentMd)} of ` +
    `$${BUDGET_USD.toFixed(2)} spent — the ceiling held.`)}`
  );
  console.log("");
  console.log(`  ${c.dim("Total spend")}      ${c.bold(usd(spentMd))} ${c.dim(`of $${BUDGET_USD.toFixed(2)}`)}`);
  console.log(`  ${c.dim("Steps allowed")}    ${killedAtStep - 1}`);
  console.log(`  ${c.dim("Killed by")}        ${c.red(killed!.replace("killed_", ""))}`);
  console.log(`  ${c.dim("Time to kill")}     ${c.bold(`${timeToKillMs} ms`)} ${c.dim("from run start")}`);
  console.log(
    `  ${c.dim("Prevented")}        ${c.bold("unbounded spend")} ` +
    `${c.dim(`— at ${usd(stepCostMd)} per step, forever`)}`
  );
  console.log("");
  console.log(rule());
  console.log("");
  console.log(
    `  ${c.dim(`This agent asked the same question ${run.peakLoopCount} times and never got`)}`
  );
  console.log(
    `  ${c.dim("anywhere. Nothing in it was going to stop — no retry cap, no")}`
  );
  console.log(
    `  ${c.dim("convergence check, no notion of its own cost. The ceiling was")}`
  );
  console.log(
    `  ${c.dim("the only thing that did.")}`
  );
  console.log("");
  console.log(
    `  ${c.cyan("See this for your own agents —")} ` +
    `${c.bold(c.cyan("thskyshield.com/start"))} ${c.cyan("(free, no infra).")}`
  );
  console.log("");
}

main().catch((err) => {
  console.error("\n  Demo error:", err instanceof Error ? err.message : err);
  console.error("  This is a bug — please report it at github.com/Thsky-21.\n");
  process.exit(1);
});

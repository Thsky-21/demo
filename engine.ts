/**
 * packages/demo/engine.ts — Local demo engine
 *
 * A faithful in-memory port of the before-step / after-step decision logic that
 * production runs as Lua inside Redis (lib/run-redis.ts). The demo runs this
 * locally so a stranger can watch an agent get governed with no account, no API
 * key, and no network.
 *
 * ⚠ THIS IS A PORT, NOT THE ENGINE ITSELF.
 * Production's engine is Lua-in-Redis — atomic, distributed, and the real thing.
 * This file re-implements the same decisions single-process. It is therefore the
 * one place in the repo that can silently drift from production behaviour, so:
 *
 *   1. It mirrors the Lua line-for-line: same check order, same post-increment,
 *      same integer-microdollar arithmetic, same off-by-one semantics.
 *   2. It is pinned by tests/demo-engine.test.ts against the Lua's documented
 *      invariants. If you change the Lua, change this and those tests together.
 *   3. It imports pricing.ts, a vendored copy of the production registry (see
 *      that file's header), so demo costs match what production would charge.
 *
 * What this port deliberately does NOT model: atomicity (single process, no
 * concurrency), TTLs, the request bridge key's expiry, fail-open behaviour, and
 * observe mode. The demo is a single sequential enforce-mode run, where none of
 * those are observable.
 *
 * This package builds standalone — see pricing.ts's header for why.
 */

import { calculateCostMicrodollars } from "./pricing";

export type KillReason =
  | "killed_timeout"
  | "killed_iterations"
  | "killed_loop"
  | "killed_budget"
  | "killed_scope_tool"
  | "killed_scope_mutation";

/** Ordered mutation-class integer, matching lib/scope.ts: read_only=0,
 *  reversible=1, destructive=2. */
export type MutationClassInt = 0 | 1 | 2;

export interface RunConfig {
  budgetMicrodollars: number;
  iterationLimit:     number;
  loopThreshold:      number;
  timeoutMs:          number;
  /** Omitted or [] = no tool restriction. */
  allowedTools?:      string[];
  /** Default 2 (destructive) = no restriction, matching beginRun's default. */
  maxMutationClass?:  MutationClassInt;
  strictScope?:       boolean;
}

export interface StepDecision {
  allowed:   boolean;
  status:    "allowed" | KillReason;
  /** Settled spend BEFORE this step, in microdollars. */
  spent:     number;
  /** In-flight reservation AFTER this step (0 on a kill, mirroring the Lua). */
  reserved:  number;
  /** Post-increment iteration counter — unique per decision, allow or kill. */
  iteration: number;
  /** Repeat count for this step's fingerprint, AFTER this step. */
  fpCount:   number;
  /** Microdollars this step reserved (0 on a kill — a killed step never runs). */
  cost:      number;
}

/**
 * Single-process stand-in for the run's Redis keys:
 * :status, :spent, :reserved, :iter, :fp:{hash}, and the ts:v1req bridge.
 */
export class DemoRun {
  private status:   "running" | KillReason = "running";
  private spent    = 0;
  private reserved = 0;
  private iter     = 0;
  private fpCounts = new Map<string, number>();
  private bridge   = new Map<string, number>();
  private startedAtMs: number;
  private nextRequestId = 0;
  private tools:            Set<string>;
  private maxMutationClass: MutationClassInt;
  private strictScope:      boolean;

  constructor(private cfg: RunConfig, startedAtMs: number = Date.now()) {
    this.startedAtMs = startedAtMs;
    this.tools            = new Set(cfg.allowedTools ?? []);
    this.maxMutationClass = cfg.maxMutationClass ?? 2;
    this.strictScope      = cfg.strictScope ?? false;
  }

  get runStatus(): "running" | KillReason { return this.status; }
  get totalSpentMicrodollars(): number { return this.spent; }
  get iterationCount(): number { return this.iter; }
  get startedAt(): number { return this.startedAtMs; }

  /** Peak fingerprint repeat count — what the loop gauge reads. */
  get peakLoopCount(): number {
    let max = 0;
    for (const n of this.fpCounts.values()) if (n > max) max = n;
    return max;
  }

  /**
   * Port of AGENT_BEFORE_STEP_SCRIPT (enforce mode).
   *
   * Check order is the Lua's and must not be reordered — containment gates
   * (scope_tool, scope_mutation, loop) before resource gates (timeout,
   * iterations, budget):
   *   status killed → scope_tool → scope_mutation → loop → timeout →
   *   iterations → budget → allow
   */
  beforeStep(params: {
    model:         string;
    inputTokens:   number;
    outputTokens:  number;
    fingerprint:   string;
    nowMs?:        number;
    stepType?:     "llm" | "tool" | "custom";
    toolName?:     string;
    mutationClass?: MutationClassInt;
  }): StepDecision & { requestId: string } {
    const nowMs = params.nowMs ?? Date.now();
    const stepType = params.stepType ?? "llm";

    // Post-increment FIRST, on every path — allow or kill. Keeps the iteration
    // (and so step_index = iteration - 1) unique and monotonic per decision.
    this.iter += 1;
    const iteration = this.iter;

    const requestId = `demo-req-${this.nextRequestId++}`;
    const kill = (status: KillReason, spent = 0, fpCount = 0): StepDecision & { requestId: string } => {
      this.status = status;
      return { allowed: false, status, spent, reserved: 0, iteration, fpCount, cost: 0, requestId };
    };

    if (this.status !== "running") {
      return { allowed: false, status: this.status, spent: 0, reserved: 0, iteration, fpCount: 0, cost: 0, requestId };
    }

    // scope_tool — trips when a toolName was provided and isn't a member of a
    // non-empty allowlist, or strict_scope is on and a 'tool' step declared no
    // toolName at all. An empty allowlist with strict_scope off is a no-op
    // (backward compatible — no restriction configured).
    const hasToolName = params.toolName !== undefined;
    if (hasToolName) {
      if (this.tools.size > 0 && !this.tools.has(params.toolName!)) return kill("killed_scope_tool");
    } else if (this.strictScope && stepType === "tool") {
      return kill("killed_scope_tool");
    }

    // scope_mutation — undeclared defaults to read_only (0) for the ceiling
    // comparison; strict_scope additionally trips on no declaration at all.
    const hasMutationClass = params.mutationClass !== undefined;
    const stepClass = hasMutationClass ? params.mutationClass! : 0;
    if (stepClass > this.maxMutationClass) return kill("killed_scope_mutation");
    if (this.strictScope && !hasMutationClass) return kill("killed_scope_mutation");

    // loop — fpCount is read BEFORE this step is counted, so with threshold N
    // exactly N identical prompts are allowed and the (N+1)th trips. Checked
    // before the resource gates: loop is a containment gate.
    const fpCountBefore = this.fpCounts.get(params.fingerprint) ?? 0;
    if (fpCountBefore >= this.cfg.loopThreshold) return kill("killed_loop", 0, fpCountBefore);

    // timeout
    if (nowMs - this.startedAtMs > this.cfg.timeoutMs) return kill("killed_timeout");

    // iterations — post-increment, so exactly `iterationLimit` steps are allowed
    // and the (limit+1)th call trips.
    if (iteration > this.cfg.iterationLimit) return kill("killed_iterations");

    // budget — the step is priced from the REAL registry, then checked against
    // settled spend + in-flight reservations. The tripping step is never
    // reserved, so an enforce budget kill lands just UNDER the ceiling.
    const cost = calculateCostMicrodollars(params.model, params.inputTokens, params.outputTokens);
    if (this.spent + this.reserved + cost > this.cfg.budgetMicrodollars) {
      return kill("killed_budget", this.spent);
    }

    // allow
    const spentBefore = this.spent;
    this.reserved += cost;
    this.fpCounts.set(params.fingerprint, fpCountBefore + 1);
    this.bridge.set(requestId, cost);

    return {
      allowed:   true,
      status:    "allowed",
      spent:     spentBefore,
      reserved:  this.reserved,
      iteration,
      fpCount:   fpCountBefore + 1,
      cost,
      requestId,
    };
  }

  /**
   * Port of AGENT_AFTER_STEP_SCRIPT. Releases the reserved *estimate* and
   * applies the *actual* cost to spent — so spent is Σ actuals, never estimates.
   * Idempotent: settling an unknown/already-settled requestId is a no-op.
   */
  afterStep(params: {
    requestId:    string;
    model:        string;
    inputTokens:  number;
    outputTokens: number;
  }): number {
    const est = this.bridge.get(params.requestId);
    if (est === undefined) return 0; // already settled or expired — no-op

    const actual = calculateCostMicrodollars(params.model, params.inputTokens, params.outputTokens);
    this.reserved = Math.max(0, this.reserved - est);
    if (actual > 0) this.spent += actual;
    this.bridge.delete(params.requestId);
    return actual;
  }
}

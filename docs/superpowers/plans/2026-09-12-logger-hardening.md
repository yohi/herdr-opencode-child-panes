# Logger Hardening Implementation Plan

> **For agentic workers:** Execute this plan inline in the current session. Do not dispatch subagents.

**Goal:** Make log-entry construction readable, prevent synchronous log-sink failures from escaping, and tolerate missing OpenCode logging objects.

**Architecture:** Keep the existing logger API and best-effort semantics. Replace only the nested conditional in `createLogEntry`, guard the sink invocation at the logger boundary, and use optional chaining in the OpenCode adapter closure. Add focused regression tests for sink exceptions and missing logging dependencies.

**Tech Stack:** TypeScript 5.6, Vitest 2, Biome 1.9, Node.js 20+, OpenCode plugin SDK.

## Global Constraints

- Preserve the `Logger` and `LogSink` public signatures.
- Logging failures must not interrupt plugin lifecycle callers.
- Do not change unrelated pane orchestration behavior.
- Verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`.
- Commit and push only the implementation, tests, and this plan document.

---

### Task 1: Cover Synchronous Sink Failures

**Files:**
- Test: `test/logger.test.ts`

**Interfaces:**
- Consumes: `createLogger(debug: boolean, sink?: LogSink): Logger`
- Produces: A regression test proving a synchronous sink exception is consumed by the logger.

- [x] **Step 1: Add the failing regression test**

Add this test after the asynchronous sink failure test:

```typescript
  it("consumes synchronous sink failures without interrupting the caller", () => {
    const sink = vi.fn(() => {
      throw new Error("log unavailable");
    });
    const logger = createLogger(true, sink);

    expect(() => logger.info("info message")).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(1);
  });
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- test/logger.test.ts`

Expected: FAIL because the current `sink(...)` call propagates the thrown `Error`.

### Task 2: Harden Logger Sink Invocation

**Files:**
- Modify: `src/logger.ts:48-60`

**Interfaces:**
- Consumes: The existing `LogSink` return type `void | Promise<void>`.
- Produces: `createLogger` consumes synchronous sink exceptions while retaining asynchronous rejection handling.

- [x] **Step 1: Wrap the sink call with synchronous failure handling**

Use a local `try/catch` around entry creation, sink invocation, and promise handling. Preserve the existing `discardLogFailure` callback for rejected promises and return after the sink path:

```typescript
    if (sink) {
      try {
        const result = sink(createLogEntry(level, message, args));
        if (result !== undefined) {
          void result.catch(discardLogFailure);
        }
      } catch (error) {
        discardLogFailure(error);
      }
      return;
    }
```

- [x] **Step 2: Run the focused logger tests**

Run: `npm test -- test/logger.test.ts`

Expected: PASS with all logger tests passing, including the synchronous failure regression test.

### Task 3: Replace the Nested Ternary

**Files:**
- Modify: `src/logger.ts:26-40`

**Interfaces:**
- Consumes: `level`, `message`, and `args` passed to `createLogEntry`.
- Produces: The same `LogEntry` values for one object argument, multiple/other arguments, and no arguments.

- [x] **Step 1: Rewrite `extra` with explicit branches**

Preserve the existing precedence and values using this control flow:

```typescript
  let extra: Record<string, unknown> | undefined;
  if (args.length === 1 && isLogExtra(firstArg)) {
    extra = firstArg;
  } else if (args.length > 0) {
    extra = { args: [...args] };
  }
```

- [x] **Step 2: Run logger tests and lint**

Run: `npm test -- test/logger.test.ts && npm run lint`

Expected: PASS with unchanged log-entry assertions and no lint errors.

### Task 4: Guard the OpenCode Log Adapter

**Files:**
- Test: `test/index.test.ts`
- Modify: `src/index.ts:76-80`

**Interfaces:**
- Consumes: The plugin input's `client` value and the existing `createLogger` sink.
- Produces: A logger sink that safely no-ops when `client`, `app`, or `log` is absent.

- [x] **Step 1: Add the missing-client regression test**

Add this test near the disabled-prerequisites test:

```typescript
  it("does not throw when debug logging has no OpenCode client", async () => {
    process.env.HERDR_CHILD_PANES_DEBUG = "true";

    await expect(
      herdrChildPanesPlugin({
        serverUrl: undefined,
      } as Parameters<typeof herdrChildPanesPlugin>[0]),
    ).resolves.toEqual({});
  });
```

- [x] **Step 2: Run the focused index test as a characterization check**

Run: `npm test -- test/index.test.ts`

Expected: PASS. The existing async sink and Promise rejection handling already prevent the malformed-input case from escaping; the test records that behavior while the optional chain removes the unnecessary rejected Promise.

- [x] **Step 3: Add optional chaining to the sink**

Change the sink body to:

```typescript
  const logger = createLogger(config.debug, async (entry) => {
    await client?.app?.log?.({ body: entry });
  });
```

- [x] **Step 4: Run the focused index tests**

Run: `npm test -- test/index.test.ts`

Expected: PASS with existing activation and URL-sanitization tests unchanged, plus the missing-client regression test passing.

### Task 5: Run the Full Quality Gates

**Files:**
- Verify: `src/logger.ts`, `src/index.ts`, `test/logger.test.ts`, `test/index.test.ts`

**Interfaces:**
- Consumes: The completed logger and plugin changes.
- Produces: Verified source, tests, lint, typecheck, and build results.

- [x] **Step 1: Run all project checks**

Run: `npm run lint && npm run typecheck && npm run test && npm run build`

Expected: All commands exit with status 0; the full Vitest suite passes and the distribution build completes.

- [x] **Step 2: Inspect the final diff**

Run: `GIT_MASTER=1 git diff --check && GIT_MASTER=1 git diff -- src/logger.ts src/index.ts test/logger.test.ts test/index.test.ts docs/superpowers/plans/2026-09-12-logger-hardening.md`

Expected: No whitespace errors and only the intended files are changed.

- [x] **Step 3: Commit the verified changes**

Run:

```bash
GIT_MASTER=1 git add src/logger.ts src/index.ts test/logger.test.ts test/index.test.ts docs/superpowers/plans/2026-09-12-logger-hardening.md
GIT_MASTER=1 git commit -m "fix: ロガーの例外処理と防御性を強化"
```

Expected: One commit containing the implementation, regression tests, and plan document.

- [x] **Step 4: Push the current branch**

Run: `GIT_MASTER=1 git push origin feature/opencode-server-log-output`

Expected: The current branch is pushed successfully without changing or merging any other branch.

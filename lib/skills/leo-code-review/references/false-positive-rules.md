# False-Positive Rules & Signal Gatekeeper

This document defines the strict filtering criteria and negative list for `leo-code-review`. The primary goal of this review is **extreme signal-to-noise ratio**. False positives erode trust and waste engineering cycles.

---

## 1. Absolute "Do NOT Flag" Negative List

Under NO circumstances should the following issues be reported:

1. **Code Style & Formatting**:
   - Indentation, bracket placement, line wrapping, quote styles (`'` vs `"`).
   - Naming preferences (e.g., `itemIdx` vs `index`, `userData` vs `user`), unless explicitly violating a repo-level rule.
   - Minor readability preferences that a linter or formatter (Prettier, Spotless, Black, ESLint) handles.

2. **Linter & Compiler Catchable Issues**:
   - Issues that standard language compilers (tsc, javac) or linters catch automatically during build (do not waste review tokens on syntax or import order).

3. **Pre-existing Code Defects**:
   - Bugs or anti-patterns residing purely in untouched context lines.
   - You may only flag issues in code that was modified, introduced, or deleted in this diff.

4. **Subjective Architectural & Refactoring Opinions**:
   - "Consider extracting this method into a separate class for cleaner architecture."
   - "You could use the Strategy pattern here."
   - Any suggestion that is merely "another way to write working code."

5. **Theoretical Conjectures Without Concrete Trigger Paths**:
   - Vague assertions such as "this might fail if the network drops" or "concurrent calls could possibly cause issues" WITHOUT detailing the exact interleaving or input that triggers the failure.

---

## 2. Permitted High-Signal Bug Categories

Unlike overly conservative PR reviews, local reviews **DO allow** reporting edge-case and state-dependent bugs, **PROVIDED** you supply a reproducible trigger condition or execution sequence:

1. **Definite Runtime Failures**:
   - Null pointer dereference / undefined access along a reachable branch.
   - Index out of bounds / off-by-one errors on slice, array, or list access.
   - Unhandled promise rejections or unhandled exceptions that crash the process or leave state corrupt.

2. **Logic Errors & Broken Contracts**:
   - Inverted conditionals (e.g., `if (!isValid)` where `if (isValid)` was intended).
   - Missing return statements or returning the wrong variable.
   - Incorrect mathematical calculations or broken aggregation logic.

3. **State, Concurrency & Resource Leaks**:
   - Unreleased connections, file handles, streams, locks, or timers.
   - Race conditions in async workflows with a demonstrable interleaving path.

4. **Silent Failure & Masked Errors**:
   - Empty catch blocks (`catch (e) {}`) that suppress critical failure without logging or degraded handling.
   - Fallbacks that mask fatal errors and return falsified success data to the caller.

---

## 3. The 0–100 Confidence Scoring Model

Every candidate issue must be scored internally:

| Score | Meaning | Action |
| :--- | :--- | :--- |
| **95–100** | Provable fatal bug / Clear requirement violation. Verified against full workspace file. | **Report** |
| **85–94** | High-probability runtime bug or demonstrable edge case with verified reachable path. | **Report** |
| **80–84** | Subtle logical defect, race condition, or requirement drift with concrete evidence. | **Report** |
| **< 80** | Speculative, unverified against full context, subjective, or minor nitpick. | **SILENTLY DROP** |

> **Hard Cutoff**: Any issue scoring below **80 points** must be immediately discarded. Never lower the threshold to "fill up" the review.

---

## 4. Independent Falsification (Devil's Advocate) Checklist

Before any issue is considered verified, the reviewer must attempt to **disprove** it using the latest full workspace files:

- [ ] **Check Guard Clauses**: Does an earlier check (e.g. `if (!user) return;` or framework interceptor) make the null condition unreachable?
- [ ] **Check Type Definitions & Framework Guarantees**: Does the framework (e.g., Spring `@NonNull`, TypeScript strict null checks, database NOT NULL constraint) guarantee the input is valid?
- [ ] **Check Caller Context**: Do all known call-sites pass valid, sanitized data?
- [ ] **Check Existing Error Handlers**: Is there an outer `try-catch`, error boundary, or global middleware catching this error?

If any of the above checks show the issue is already mitigated, **the issue is falsified and must be discarded**.

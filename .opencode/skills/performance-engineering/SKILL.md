---
name: performance-engineering
description: Evaluate critical-path latency, throughput, memory, I/O, query behavior, concurrency and cost using measurements or defensible static evidence.
license: MIT
compatibility: opencode
metadata:
  category: performance
  scope: universal
---

# Performance Engineering

## Scope

Determine whether the change touches a hot path, unbounded input, repeated I/O, database query, serialization, cache, network call, queue, lock or memory-retaining lifecycle.

## Review dimensions

- algorithmic growth and boundedness;
- N+1 queries or requests;
- blocking work on asynchronous/event-loop paths;
- excessive allocations, copies or retained objects;
- missing pagination, batching, streaming or backpressure;
- cache correctness and stampede behavior;
- lock contention, race-induced retries and thread-pool starvation;
- timeout and retry amplification;
- payload size, compression and serialization cost;
- infrastructure and model/API usage cost.

## Measurement

Prefer an existing benchmark or load test. Establish baseline and changed result under comparable conditions. Record environment, dataset, warm-up, repetitions and percentile or resource metric. Never claim improvement from a single noisy observation.

When execution is impractical, mark the result as static analysis and explain residual uncertainty.

## Verdict

FAIL when a requirement is missed, an unbounded critical path is introduced, or evidence demonstrates material regression. PASS_WITH_WARNINGS is allowed for measured or bounded residual risk with a monitoring recommendation.

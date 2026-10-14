---
name: token-economy
description: Minimize model context and cost through lazy loading, search-first exploration, diff-focused reasoning and concise artifact handoffs.
license: MIT
compatibility: opencode
metadata:
  category: efficiency
  scope: universal
---

# Token Economy

## Read strategy

- Start with run state and the immediately preceding report.
- Search by filename, symbol, route, endpoint, error text or test name before opening files.
- Read the smallest range that contains the relevant declaration plus direct dependencies.
- For generated, vendored, lock and build-output files, inspect metadata or diff summaries instead of full content.
- Use the repository profile as a cache. Revalidate only facts affected by the current diff.

## Reasoning strategy

- Separate known facts, assumptions and unresolved questions.
- Do not narrate routine tool use.
- Do not repeat the request in every report.
- Reuse stable identifiers for requirements, risks, tasks and findings.
- Prefer tables or compact keyed lists in artifacts when they improve traceability.

## Execution strategy

- Parallelize audits that consume the same completed implementation and do not modify files.
- Run the narrowest focused test first, then the necessary broader regression suite.
- After a repair, rerun only the failed check and checks downstream of the modified behavior.
- Avoid expensive external research when local manifests, source and tests answer the question.

## Handoff strategy

Write detailed evidence into the artifact. Return to the parent only:

1. status;
2. artifact path;
3. top blockers or risks;
4. exact next action.

Never paste the artifact back into the parent response.

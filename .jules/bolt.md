## 2025-03-05 - Batched API Calls Optimization
**Learning:** Sequential API calls in array iterations (like auditing groups) create severe scaling bottlenecks for network-bound tasks.
**Action:** When a method executes identical API calls per item without interdependencies (like fetching chat info), replace sequential loops with `Promise.all` batching. Use a constant batch size to improve performance while respecting API rate limits.

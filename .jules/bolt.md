
## 2025-03-23 - Batched Promise.all in network-bound loops
**Learning:** For network-bound tasks over arrays of independent items, using a sequential `for...of` loop creates an unnecessary bottleneck.
**Action:** When working with independent items, always replace sequential `for...of` loops with a batched `Promise.all` approach to optimize execution time, and `push(...batchResults)` to preserve array order.

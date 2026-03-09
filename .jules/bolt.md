# Bolt Journal

## Initial Entry
**Learning:** Journal created.
**Action:** Ready to optimize.

## 2024-05-23 - Avoid Regex in Hot Path Array Iterations
**Learning:** When evaluating string prefixes inside hot loops over an array (like in `isSenderAllowed` evaluating access on every message event), using regex `.replace()` inside higher-order array methods like `.some()` is extremely inefficient due to callback overhead and repeated string allocations.
**Action:** For hot paths, pre-calculate the required string variations before the loop, use standard `for` loops, and implement exact-match fast paths (e.g., `array.includes(value)`) to avoid normalization costs on typical cases.
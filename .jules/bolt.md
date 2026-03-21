## 2024-03-24 - String prefix search inside hot loops
**Learning:** For high-frequency loops searching string arrays (like `isSenderAllowed`), using higher-order methods (`.some()`) and regex inside the loop is a major performance bottleneck. Standard arrays and fast native string methods (`.startsWith()`) offer significantly faster execution.
**Action:** Always avoid regex and `.some()`/`.filter()` inside hot-path loops over large strings or arrays in favor of exact match fast-paths (`.includes()`), traditional `for` loops, and `.startsWith()`.

## 2024-05-24 - High-Frequency String Parsing Opts
**Learning:** When evaluating string prefixes inside hot loops over an array (e.g., in `isSenderAllowed`), using regex `.replace()` inside higher-order array methods like `.some()` introduces significant callback and compilation overhead.
**Action:** Use native string methods like `.startsWith()` combined with standard `for` loops, and include an exact-match fast path (e.g., `array.includes(value)`) for significant performance improvements without sacrificing readability.

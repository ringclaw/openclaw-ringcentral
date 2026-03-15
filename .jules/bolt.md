## 2024-05-23 - Optimize string prefix matching inside array loops

**Learning:** When evaluating string prefixes inside hot loops over an array (e.g., in `isSenderAllowed`), avoid using regex `.replace()` inside higher-order array methods like `.some()`. Instead, use native string methods like `.startsWith()` combined with standard `for` loops, and include an exact-match fast path (e.g., `array.includes(value)`) for significant performance improvements without sacrificing readability.

**Action:** Replace `array.some(x => x.replace(/^prefix:/i, '') === target)` with `array.includes(target)` followed by a standard `for` loop using `startsWith` and `slice` for checking prefixes on remaining items.


## 2024-05-20 - Array methods overhead in hot paths
**Learning:** High-frequency searches using Array.find() and Array.includes() with nested callbacks add significant overhead in hot paths (like finding chats by member).
**Action:** Replace higher-order array methods with standard for-loops and direct index comparisons (e.g. members[0] === id) for simple exact-match lookups to improve execution speed.

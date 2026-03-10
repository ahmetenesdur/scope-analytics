## 2024-03-10 - Missing Database Index for Sort Operations
**Learning:** `swap_events` are regularly fetched sorted by `block_number DESC` and `log_index DESC` without an index supporting this ordering, leading to a full table scan and inefficient in-memory sorting using a temporary B-tree.
**Action:** Always verify if queries involving `ORDER BY` operations have supporting indexes, especially on growing analytical datasets where missing indexes severely degrade performance.

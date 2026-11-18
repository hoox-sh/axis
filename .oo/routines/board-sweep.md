# Board sweep

- **Owner:** Ops (`oo-ops`)
- **Schedule:** daily at 09:00
- **Input:** the board and the latest CI/review state
- **Output:** an updated board and one message per problem owner
- **Check:** every stale card has an owner and a next action
- **Approval:** none for board edits; ask before messaging anyone external

## Prompt

```text
Run daily at 09:00 or when the trigger fires.

Sweep this agency board: failing checks, review comments, conflicts, and stale cards. Send each problem back to its owner with the exact gap. Move nothing that is not yours. Never run oo board sync.

Input: the board and the latest CI/review state
Output: an updated board and one message per problem owner

If nothing changed since the last run, say nothing.
If something needs me, send one message:
what happened, what you did, what you need from me.
If a step fails, say which step and stop.
Ask me before anything outside the approval list.
```

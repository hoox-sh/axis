# 2560×1440 series

Viewport **2560×1440**, `deviceScaleFactor: 2` → PNG **5120×2880**.

Same shot list as the 1080p series (`app/`, `studio/`, `landing/`). Recapture:

```bash
bun run capture:1440p
bun scripts/capture-fix.ts --viewport=2560x1440 --dpr=2 --out=docs/images/2560x1440
```

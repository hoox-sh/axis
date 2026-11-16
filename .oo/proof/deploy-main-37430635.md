# Deploy proof: origin/main = 37430635 on axis.hoox.sh

Date: 2026-11-16 · Pushed `573f8553..37430635 main -> origin` (Pages deploy).

## Pages (https://axis.hoox.sh)
`curl -s https://axis.hoox.sh/version.json` →
```json
{
  "version": "2.30.0",
  "git": "3743063561a9ee37c93b1a812e8a65c1d8712b44",
  "gitShort": "3743063561a9",
  "dirty": false,
  "buildTime": "2026-11-16T13:20:50.678Z"
}
```
`.git` equals pushed HEAD `3743063561a9` — Pages serves this commit (verified 14:33 local).

## Worker (https://worker.axis.hoox.sh)
Not deployed by the push. Worker ships via `axis deploy worker` / `axis deploy all`.
No `worker/` changes in this range (`git diff --stat 573f8553..37430635 -- worker/` is empty).

## What shipped in 573f8553..37430635
- feat(dev): mock-walk 10s venue + sealed-value repaint harness (324448e3)
- fix(replay): viewport re-anchor on replay repaint + live-ingress fences for the venue (e7cdddaa)
- chore(debug): commit-store reset breadcrumb (f68cfb1a)
- fix(editor): LSP hover/docs-card formatting (a745cd56)
- chore/fix: settings multiline declaration (4d053e6c), studio polish (dc17a190)
- docs(oo): board cards + proofs (37430635)

## Open
- Live "lines drift" confirmation via `commit-store.reset` log on a live session
  (board: "AXIS live: close-verify is exact-compare …").

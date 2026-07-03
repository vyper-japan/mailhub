# SHIELD W3 summary: scripts/lolipop-mailhub-routing migration

## 判定

**Case B: 移管必要。ただし W3 migration branch は既に作成済みのため、新規 checkout / commit は実施せず既存成果物を採用。**

根拠:

- current worktree / HEAD (`feat/mailhub-lolipop-12addr-audit-poll`) では `scripts/lolipop-mailhub-routing/lolipop_forward_setup.py` は存在しない。
  - `ls scripts/lolipop-mailhub-routing/` => `poll_5addrs.py` のみ。
  - `find . -name lolipop_forward_setup.py -not -path "./node_modules/*" -not -path "./.git/*"` => no output。
- superset 探索では現存 source は見つからない。
  - 指示どおりの `find ~/VYPER-Dev -maxdepth 4 -name lolipop_forward_setup.py` => no output。
  - 追加確認 `find ~/VYPER-Dev -maxdepth 8 -name lolipop_forward_setup.py` => no output。
- git 履歴上、対象 migration は既に専用 branch に 1 commit で存在する。
- branch: `feat/lolipop-routing-scripts-migration`
- commit: `9840c3adb2dd34777b75af4cc2edf5ae7250f594`
- commit title: `feat(mailhub): migrate scripts/lolipop-mailhub-routing/ from superset worktree`
- requested commit title: `feat(lolipop-routing): migrate forward_setup script from superset worktree to canonical repo`
- note: existing branch content/base/sha256 は要件を満たすが、既存 commit title は指定文言と完全一致しない。W3 turn 中に一時 worktree で subject amend を試みたが、sandbox が `.git/worktrees` 書き込みを拒否したため branch は未変更。

## Case B 成果物

- base: `main` @ `b6e1aea09532831e67079112ca170d9d0eddac59`
- merge-base (`main`, `feat/lolipop-routing-scripts-migration`): `b6e1aea09532831e67079112ca170d9d0eddac59`
- branch ahead count: `main..feat/lolipop-routing-scripts-migration` = `1`
- commit SHA: `9840c3adb2dd34777b75af4cc2edf5ae7250f594`
- source provenance (commit body / README):
  - superset worktree: `mail-hub-shield-dev`
  - source path: `mail-hub-shield-dev/scripts/lolipop-mailhub-routing/lolipop_forward_setup.py`
  - ledger import: `orca-repo-split-2026-06-27/phase1-v5-ledger/import-20260629-070659`
- destination:
  - `scripts/lolipop-mailhub-routing/lolipop_forward_setup.py`
  - `scripts/lolipop-mailhub-routing/README.md`
- file list in branch:
  - `scripts/lolipop-mailhub-routing/README.md`
  - `scripts/lolipop-mailhub-routing/lolipop_forward_setup.py`
- diff stat:
  - 2 files changed, 785 insertions(+)
  - `README.md`: 98 lines
  - `lolipop_forward_setup.py`: 687 lines
- content sha256:
  - `scripts/lolipop-mailhub-routing/lolipop_forward_setup.py`
  - `9024ff2dd72a9f6771de0a1ebea77ab680d0c10c13207a0bbd793fb288457bc6`

## Import / reference 影響範囲 grep

`git grep -n "lolipop_forward_setup" feat/lolipop-routing-scripts-migration -- .` の結果:

- `.ai-runs/mailhub-next-phase/NEXT_SESSION_HANDOFF.md`: usage/reference only
- `.ai-runs/mailhub-next-phase/progress.md`: provenance/reference only
- `scripts/lolipop-mailhub-routing/README.md`: migration provenance and usage docs
- `scripts/lolipop-mailhub-routing/lolipop_forward_setup.py`: script self-docstring / usage

migration branch 単体では、既存 import path を修正すべき code callsite は検出されなかった。

現 HEAD (`feat/mailhub-lolipop-12addr-audit-poll`) では W2 の `scripts/lolipop-mailhub-routing/poll_5addrs.py` が同一ディレクトリの `lolipop_forward_setup` を lazy import する。これは W2/W3 の merge-order dependency であり、W3 branch の対象ファイル追加により満たされる。

## recon-report.md との整合

PM Phase 0 recon (`phase0/recon-report.md`) は W3 について以下を示していた。

- canonical `scripts/` は存在。
- `lolipop_forward_setup.py` 相当の未移管 `lolipop_*.py` は superset / orca / `/private/tmp/claude-501` で見つからない。
- W3 は「外部由来なし、新規作成準備完」という状態。

今回の実測も、current canonical HEAD に `lolipop_forward_setup.py` が無く、superset 探索でも現存 source が見つからない点で recon と整合する。一方、git ref には recon 後または並行 worker により作成済みの `feat/lolipop-routing-scripts-migration` があり、親裁定 Q5 追加推奨 (P1) #1 はこの branch / commit により満たせる。

## 実施しなかったこと

- Lolipop 管理画面へのアクセスなし。
- Gmail / Workspace admin / OAuth / env mutation なし。
- destructive な削除・rename なし。
- branch checkout なし。
- commit なし。
- push なし。
- 一時 worktree 作成は試行したが、sandbox の `.git/worktrees` write deny により失敗。branch / files は変更されていない。

現作業ツリーには W2 由来の未コミット変更があるため、W3 では checkout / cherry-pick 等を行わず、既存 migration branch の read-only 検証と summary 作成に限定した。

## Phase 1.5 self-check

- 判定根拠: canonical 存在確認、superset 探索、git 履歴、branch/base/commit/sha256 を summary に明示済み。
- Case A 不採用理由: current canonical HEAD に `lolipop_forward_setup.py` が存在しないため。
- Case B 成立理由: `feat/lolipop-routing-scripts-migration` が `main` @ `b6e1aea` から 1 commit で対象 2 files を追加済み、script sha256 が provenance と一致。
- destructive safety: 外部サービス・管理画面・送信・設定変更は未実行。ファイル削除・rename なし。
- local git safety: commit title を指定文言に合わせるため `git worktree add /private/tmp/mailhub-w3-lolipop-routing-migration feat/lolipop-routing-scripts-migration` を試行したが、sandbox の `.git/worktrees` write deny で失敗。branch は `9840c3a` のまま。
- commit scope: 既存 W3 branch は 1 commit。W3 現 turn では W2 変更を避けるため新規 commit は作成していない。commit title 完全一致だけは sandbox 制約で未反映だが、migration tree / base / sha256 は PASS。

## STATUS: PASS

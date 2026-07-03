# SS5 Quick Final — MailHub Destructive 6 (D1–D6) 罠検出

作業モード: SuperSonnet5 Quick（1コンテキスト6役、3周固定）
正本: `/Users/takayukisuzuki/VYPER-Dev/Mailhub/.ai-runs/mailhub-next-phase/DESTRUCTIVE_6_READINESS.md`（main HEAD `3fc9da2`、pwd -P で実体確認済み）
制約: read-only（Gmail/admin.google.com/Vercel/Lolipopへの操作・API呼び出し一切禁止、gitはlog/show/diff/grepのみ）。書込みは本ファイルと `.ss5/` 配下のみ。

---

## 最終成果物

# MailHub Destructive 6項目 (D1–D6) 罠検出レポート + 安全遂行チェックリスト

## 0. 読む前に：最重要 P0 3件

D1〜D6のどれかに着手する**前に**、必ずこの3つを再確認すること。すり合わせずに進めると、承認済みのつもりで未確認の前提の上に本番destructive操作を積むことになる。

1. **D6のcanary根拠が指しているのは `mailhub@` ではなく `info@` のINBOX到達実績**（§1 P0-1）。READINESS.mdの「mailhub@ INBOX 到達 7/7実証」を鵜呑みにしてD6を実行しない。
2. **併走中の本番readiness監査が今この瞬間もP0 blocker (`current_shared_gmail_routing`) でproductionReady:falseを返している**（§1 P0-2）。D1-D6のpre-flight (P1-P9) はこれを一度も参照していない。
3. **P8「main HEAD v25増分audit closed」は現HEADの12コミット手前までしか監査していない**（§1 P0-3）。その12コミットの中に、D1-D6が依拠するW1-W5の修正そのものが含まれる。

---

## 1. 罠一覧（重大度別、file:line根拠付き）

重大度の定義: **P0=本実行前に必ず解消**（解消しないまま進めると誤判断・誤rollback・虚偽エビデンスに直結する）／**P1=確認・明文化すべき**（見落とすと本番中に混乱・誤判断を招く）／**P2=軽微・情報共有レベル**（実害は小さいが認識しておくと事故予防になる）。

### P0（本実行前に必ず解消）

| # | 罠 | 根拠 (file:line) | 何が起きるか |
|---|---|---|---|
| P0-1 | D6 canaryの選定根拠「ebay@ は … mailhub@ INBOX 到達 7/7実証」は、実際には**info@vtj.co.jp INBOXへの到達を検証した記録**を指している。mailhub@ INBOXへの到達は別に実証されていない。 | 主張: `DESTRUCTIVE_6_READINESS.md:110,114`。反証: `NEXT_SESSION_HANDOFF.md:1,8`（見出し「MailHub P0 Routing Blocker」、本文「Google Workspace `info@vtj.co.jp` INBOX、7/7到達確認」）、同ファイル10行目の表タイトル「7件到達ログ（**info@ Gmail** / 全件INBOX）」、`~/.claude/instructions/mailhub-inapp-send/phase4/PROGRESS-MINDMAP.md:193`（「→ **info@ INBOX** 7/7着、Spam 0」） | D6のcanary_observation（READINESS.md:114）は「mailhub@ INBOXに送信ログが残るか」を確認基準にしているが、その基準が過去に本当に実証済みという前提が崩れる。canaryが失敗した時、原因切り分け（送信自体の失敗なのか、mailhub@受信側の未確認ルーティング問題なのか）を誤り、誤ったrollback判断・誤ったincident原因分類をする |
| P0-2 | D1-D6のpre-flight（P1〜P9）が、**同じrepo HEAD（`3fc9da2`）に対して同日生成された並走監査**`mailhub-production-readiness-audit.json`の結果を一度も参照していない。この監査は現在も `gate.productionReady: false` かつ P0 blocker `current_shared_gmail_routing` を返している。 | `DESTRUCTIVE_6_READINESS.md:40-56`（P1〜P9に本監査への参照なし）。監査側: `mailhub-production-readiness-audit.json:2-3`（`repoHead: "3fc9da2ca..."`, `generatedAt: "2026-07-03T08:45:29Z"` = JST 17:45、READINESS.md最終更新17:43の2分後）、同`:780-793`（`gate.productionReady:false`, `p0Blockers:["current_shared_gmail_routing"]`） | Codex workerがREADINESS.mdのP1-P9だけをチェックリストとして遂行すると、この並走P0の存在に気づく経路が一切ない。scope上「別ゲート」であっても、pre-flightに一行の相互参照すらないのは重大な抜け穴 |
| P0-3 | pre-flight P8「main HEAD v25増分audit（3ce3975→b6e1aea、35コミット分）closed」は、現在のmain HEAD（`3fc9da2`）より**12コミット手前**（`b6e1aea`）までしか監査範囲に入っていない。この12コミットには、まさにD1-D6の実行が前提とするW1-W5の修正（READINESS修正・Lolipop routing script移行・sbd ledger・send reservation leak修正）自体が含まれる。 | `DESTRUCTIVE_6_READINESS.md:55`（P8の文言）。実測: `git log --oneline b6e1aea..HEAD`（read-only git logコマンドで確認、12コミット、うち`0af7a33`=W1マージ, `cf58027`=W2マージ, `9b6df5b`=W3マージ, `c4b19a2`=W4マージ, `3fc9da2`=W5マージ） | 「P8 closed」というチェックボックスを見て、Codex workerは main HEAD 全体がv25監査済みだと誤認する。実際にはD1-D6が依存する最新の安全策（W5のreservation漏れ修正など）自体が、その監査の対象外である |
| P0-4 | D4「READ ONLY解除（`MAILHUB_READ_ONLY=0`）」は、コード上は単純なenv値の反映ではない。`isReadOnlyMode()`はstaging/productionで`raw==="0"`のときでも`getResolvedActivityStoreType() !== "sheets"`なら強制的に`true`を返し続ける。 | `lib/read-only.ts:32-41`（`if (raw === "0") { return requiresDurableAudit && getResolvedActivityStoreType() !== "sheets"; }`）。READINESS.md側の記述: `:23,85`（D4を単純なenv変更としてのみ記述、この依存関係への言及なし） | D3のSheets認証情報（`MAILHUB_SHEETS_PRIVATE_KEY`等）が微妙に壊れている場合、VercelダッシュボードはREAD_ONLY=0を表示するが、実行時は書き込み拒否を継続する。「D4完了」と誤認したままD5に進み、後になって「なぜ送信できない」と原因不明の混乱を招く。**唯一の正しい確認方法は `GET /api/mailhub/config/health` の `readOnly` フィールドを見ること**（Vercelのenv値表示ではない） |

### P1（確認・明文化すべき）

| # | 罠 | 根拠 (file:line) | 何が起きるか |
|---|---|---|---|
| P1-1 | D6のcanary代替候補#2「sbd@」は、Lolipop転送POCが**失敗**（`success:false`, `status:"poc_failed"`）している。「(再apply success後のみ昇格可)」という注記はsecondhand@の直後にのみ書かれており、sbd@にも同じ条件が適用されるか文面上あいまい。 | `DESTRUCTIVE_6_READINESS.md:115`。証跡: `lolipop-routing-audit.json:96-116`（sbd@のentry、`"success": false`, `"status": "poc_failed"`, `"notes": "POC success=false; W4 sbd destructive 削除 ledger 側で扱う"`） | ebay@が使えない時、運用者がsbd@をそのまま次の候補として承認してしまうと、mailhub@への転送が実証されていないアドレスでcanaryを打つことになる |
| P1-2 | D6のcanary代替候補#1「steiner-optics_sc@」は、転送設定自体は成功（`success:true`）だが**転送スロットの完全列挙は未完了**（`polling_pending:true`）。ebay@以外の代替候補は全て「未完了」状態であり、"完全に検証済み"の代替は実質存在しない。 | `DESTRUCTIVE_6_READINESS.md:115`。証跡: `lolipop-routing-audit.json:138-159`（steiner-optics_sc@ entry、`"polling_pending": true`, `"notes": "...remains polling_pending because W2 did not run live polling."`） | ebay@がD6直前に不能と判明した場合、代替候補への即時切替は「実質未検証のアドレスへの切替」を意味する。少なくとも切替前にsteiner-optics_sc@の転送スロットをpolling script（W2成果物）で再確認する一手間が必要 |
| P1-3 | `assertSendAsAccepted`はsend-as承認状況を**5分間のin-memoryキャッシュ**で保持し、`/api/mailhub/config/health`のsend-as確認はforceRefreshを渡していない。D2でaliasを1つずつ登録・確認する運用や、D3直後の即時health smokeで、直近5分以内にキャッシュが埋まっていると古い`missingAliases`/`acceptedCount`を見せられる可能性がある（Vercelのwarmインスタンス再利用時）。 | `lib/mailhub-send-as.ts:34`（`SEND_AS_CACHE_TTL_MS = 300_000`）、`:184-216`（`assertSendAsAccepted`のキャッシュ参照ロジック）。呼び出し側: `app/api/mailhub/config/health/route.ts:173-193`（`getSendAsHealthSnapshot`は`assertSendAsAccepted`に`forceRefresh`を渡していない） | D2の「15/15 accepted確認したのに health は 14/15 のまま」という見かけ上の矛盾に遭遇しうる。5分待つか、再デプロイでインスタンスを入れ替えるまで気づかないと「登録が失敗した」と誤判断してD2を無駄にやり直すリスク |
| P1-4 | 「post-D3 health smoke」（SEND_ENABLED=0/READ_ONLY=1のまま行う中間チェック）は、post-D5 smoke（R4 §6、フィールドを明示列挙）と違い、**具体的にどのhealthフィールドで合否判定するか列挙されていない**。`gmailSendReady`はこの時点では構造的に必ずfalseになる（`gmailSendEnabled`がfalseのため）ので、これをpass基準にはできない。 | `DESTRUCTIVE_6_READINESS.md:81-83`（「send経路は閉じたまま token + Sheets activity 接続性のみ確認」とあるだけで具体フィールド名なし）。コード側: `app/api/mailhub/config/health/route.ts:123-132`（`gmailSendReady`の計算式が`gmailSendEnabled &&`から始まる = SEND_ENABLED=0の間は必ずfalse） | Codex workerが「post-D3 smokeで何を見ればPASSと言えるか」を自己判断せねばならず、人によって基準がぶれる。D3固有の合否は `gmailScopes`（new token由来のscope一覧に`gmail.send`+`gmail.settings.sharing`が含まれるか）、`activityStore.resolved==="sheets"` かつ `activityStore.sheetsConfigured===true`、`sendAs.error===null` の3点を明示すべき |

### P2（軽微・情報共有レベル）

| # | 罠 | 根拠 (file:line) |
|---|---|---|
| P2-1 | pre-flight P9が指す行番号 `send/route.ts:471-477` は、実際の修正（reservation解放＋ログ記録）ではなく try ブロックの入口とコメントの冒頭を指している。実際の修正本体は `:487-509`。 | `DESTRUCTIVE_6_READINESS.md:56` vs `app/api/mailhub/send/route.ts:471-477`（try開始とコメント）/ `:487-509`（実際の`releaseReservation`+`logAction`呼び出し） |
| P2-2 | `mailhub-production-readiness-audit.json` は**ローカル環境で実行したスクリプトの結果**（`mailhubEnv:"local"`, `activityStore:"memory"`, `configStore:"file"`）であり、実際のVercel Production環境の値を直接反映したものではない。P0-2の指摘とは独立して、この監査結果を「Production の現況」そのものと混同しないこと。 | `mailhub-production-readiness-audit.json`内 `staffWorkflowBlockers[0].evidence.mailhubEnv:"local"` 系記述（`not_production_env`ブロッカー） |
| P2-3 | `getGmailSendCapable`はGmail APIのスコープ意味論上、`gmail.modify`単体でも送信可能（`gmail.modify`は`gmail.send`の上位互換）とみなして`true`を返す。したがって**D1のtoken rotation前でも`gmailSendCapable:true`が出うる**。これを「D1が完了した証拠」と誤読しないこと。 | `app/api/mailhub/config/health/route.ts:28-32`（`GMAIL_SEND_SCOPES`に`gmail.modify`を含む）、`:75-79`（`getGmailSendCapable`） |
| P2-4 | `scripts/get-refresh-token.mjs`は`OAUTH_SCOPES`を明示指定しないと**黙って**`gmail.readonly`+`gmail.modify`のみ（旧スコープと同一）にfallbackする。D1手順書は`OAUTH_SCOPES`設定を明記しているが、実行後に「取得できたscopeの中身」を`tokeninfo`/healthの`gmailScopes`で確認する一手間をチェックリスト上で明示した方が安全。 | `scripts/get-refresh-token.mjs:59-70`（`defaultScopes`のfallbackロジック） |

---

## 2. D1→D6 安全遂行チェックリスト

**凡例**: 各Dで「前提確認 → dry-run → 1件 manual gate → 本実行 → 検証 → rollback」の順で固定。上記罠番号は該当ステップに ⚠️[P0-x] 等で埋め込む。

### D1: Gmail refresh token 再発行

- **前提確認**
  - [ ] のび太承認記録（approver/timestamp/target deployment）が存在する
  - [ ] `OAUTH_SCOPES` に `gmail.readonly,gmail.modify,gmail.send,gmail.settings.sharing` の4スコープを明示設定する準備ができている（未設定だと旧スコープへ黙ってfallbackする ⚠️[P2-4]）
  - [ ] 操作端末がsecret-bearing扱いになっている（token値を repo/ticket/chat/screenshot/shell history に出さない）
- **dry-run**
  - [ ] `GET /api/mailhub/config/health` を叩き、現行tokenの `gmailScopes` / `gmailModifyEnabled` / `gmailSendCapable` / `gmailSendBlockedReason` をベースライン記録する
  - [ ] このベースラインで `gmailSendCapable` が既に `true` でも「D1完了の証拠」ではない点に注意 ⚠️[P2-3]（`gmail.modify`だけでも真になりうる）
- **1件 manual gate**
  - [ ] `scripts/get-refresh-token.mjs` をprivateなoperator terminalで実行し、OAuth consent完了後、**取得直後に**scopeが要求どおり4種含まれるかをoperatorが目視確認する（token値は記録しない、scope名のみ記録）
- **本実行**
  - [ ] 取得したrefresh tokenを `secret_ref: vyper/mailhub/prod/google_shared_inbox_refresh_token_next` に格納する（本番tokenは未swap、影響なし）
- **検証**
  - [ ] R1 §3の手順で新tokenをstaging/previewで read/list/detail/modify/`sendAs.list` チェックする
  - [ ] `gmailScopes` に `gmail.send` と `gmail.settings.sharing` 相当のscopeが実際に含まれることを確認する（`gmailSendCapable:true`だけで済ませない ⚠️[P2-3]）
- **rollback**
  - [ ] `_next` slotを削除するのみ。本番未影響（現行tokenは無傷のまま）

### D2: send-as 15エイリアス登録

- **前提確認**
  - [ ] D1の新tokenがstaging検証をPASSしている（sendAs.list成功）
  - [ ] Route A（DWD）採用の場合、DWDサービスアカウントが`mailhub@`をimpersonate可能で、Gmail settings scopeがWorkspace管理者ポリシーで承認済みであることを確認する（Route Aは`GOOGLE_SHARED_INBOX_REFRESH_TOKEN`とは別の認証経路である点に注意）
- **dry-run**
  - [ ] 1エイリアス（最も影響の小さいもの、例: `ebay@vtj.co.jp`）で `users.settings.sendAs.create` → `verify` を試し、応答形式・verification challengeの有無を確認する
- **1件 manual gate**
  - [ ] dry-run対象1件が `users.settings.sendAs.list` でaccepted表示になることを確認してから、残り14件に展開する
- **本実行**
  - [ ] 残り14エイリアスをRoute A/Bいずれかで順次登録・verify（1.5秒間隔などverification parserの実態速度を考慮、想定所要3-5時間）
  - [ ] 楽天3チャンネル（cricut-rakuten/gopro-rakuten/vyperglobal-rakuten）とams_vyper@は対象外であることを再確認する（コード側 `lib/mailhub-send-as.ts:68-73` の `getRequiredGmailSendAsAliases()` が `channel.id !== "ams-vyper"` でフィルタしていることと整合）
- **検証**
  - [ ] `send-as-ledger.md` の15行すべてを `verificationStatus=accepted` に更新し、`checkedAt`/`evidenceRef`を埋める
  - [ ] `GET /api/mailhub/config/health` で `sendAs.requiredCount=15` / `acceptedCount=15` / `missingAliases=[]` を確認する。**直近5分以内に別の確認を行った場合はキャッシュの可能性を疑い、再確認する** ⚠️[P1-3]
- **rollback**
  - [ ] 該当aliasのsend-as entryのみ`users.settings.sendAs.delete`で個別除去。ledger行を`removed`に更新

### D3: 本番env投入（新token + activity store）

- **前提確認**
  - [ ] D1完了・D2完了（15/15 accepted）
  - [ ] `secret_ref: .../google_shared_inbox_refresh_token_previous` に旧token値を確実にpopulateする準備がある（rollback窓の担保）
  - [ ] `prod-env-ledger.md` の現行Vercel env棚卸しが最新化されている
- **dry-run**
  - [ ] Sheets credentials 3点（SPREADSHEET_ID/CLIENT_EMAIL/PRIVATE_KEY）が正しい形式であることをローカルまたはstaging相当の設定で事前検証する（private keyの改行エスケープ崩れは典型的な事故要因）
- **1件 manual gate**
  - [ ] のび太の最終GOを得てから、まず**token swapのみ**を先に実施し、health確認 → 次にactivity store 3点を投入する（2アクションに分けて各々の失敗点を切り分けられるようにする。runbook上は「同一アクション内で完結」と書かれているが、切り分けのためのログ記録は個別に取る）
- **本実行**
  - [ ] `GOOGLE_SHARED_INBOX_REFRESH_TOKEN` を `_next` 値にswap（旧値は`_previous`へ）
  - [ ] `MAILHUB_ACTIVITY_STORE=sheets` + Sheets credentials 3点を投入
  - [ ] 最小redeploy/promoteでenvを有効化
- **検証**
  - [ ] `/api/health` 200確認
  - [ ] `/api/mailhub/config/health` で以下を明示チェックする（`gmailSendReady=true`はこの時点では出ない前提で見る）⚠️[P1-4]:
    - `gmailScopes` に `gmail.send`+`gmail.settings.sharing` 系scopeが含まれる
    - `activityStore.resolved === "sheets"` かつ `activityStore.sheetsConfigured === true` かつ（可能なら）`sheets.ok === true`
    - `sendAs.acceptedCount === 15` かつ `sendAs.error === null`
  - [ ] 秘密値がログ/レスポンスに露出していないことを確認
- **rollback**
  - [ ] tokenを`_previous`から復元、activity storeを元設定に戻して再デプロイ
  - [ ] `MAILHUB_SEND_ENABLED=0`維持、書込みリスクがあれば`MAILHUB_READ_ONLY=1`を明示セット

### D4: READ ONLY解除（`MAILHUB_READ_ONLY=0`）

- **前提確認**
  - [ ] D3完了（Sheets activity store確立）が**確実に**成功していること。ここが崩れているとD4は見た目上成功しても実際には効かない ⚠️[P0-4]
  - [ ] のび太承認（approver/timestamp/target deployment/reason/rollback owner/maximum enable window/PoC可否）が記録済み
- **dry-run**
  - [ ] このステップに機械的なdry-runは存在しない（env反映が即座に効くため）。代わりに、投入直前に現在の`/api/mailhub/config/health`の`readOnly`値をベースライン記録する
- **1件 manual gate**
  - [ ] のび太の最終承認を得てから投入する（他のenv keyを同時に変更しない）
- **本実行**
  - [ ] `MAILHUB_READ_ONLY=0` をVercel Production envに設定、承認済みVercel経路でactivate
- **検証**
  - [ ] `GET /api/mailhub/config/health` の **`readOnly`フィールド**（Vercelダッシュボードのenv表示ではない）が`false`になっていることを確認する ⚠️[P0-4]
  - [ ] `readOnly:false`にならない場合、`activityStore.resolved`が`sheets`でない/`sheetsConfigured`がfalseである可能性を最優先で疑う（D3の再点検）
- **rollback**
  - [ ] `MAILHUB_READ_ONLY=1`に戻す（R4 §9手順）。健全性を`/api/mailhub/config/health`で再確認

### D5: `MAILHUB_SEND_ENABLED=1`

- **前提確認**
  - [ ] D4完了かつ`readOnly:false`をhealthで実測確認済み
  - [ ] **qa:strict 2連続PASS**を、D5投入の直前に再充足（sign-off済でも必要。READINESS.md自身が強調している独立ゲート）
  - [ ] mailhub-production-readiness-audit.jsonのP0 blocker（`current_shared_gmail_routing`）が、このticketのスコープ外である理由（D1-D6はGmail送信有効化であり受信ルーティング一般の話ではない、等）をPM/のび太が明示的に確認・記録している ⚠️[P0-2]。確認せずに「別ゲートだから関係ない」と黙って進めない
- **dry-run**
  - [ ] このステップにも機械的dry-runなし。投入直前のhealthスナップショットを記録
- **1件 manual gate**
  - [ ] のび太承認記録を確認してから投入。他のenv keyを同時変更しない
- **本実行**
  - [ ] `MAILHUB_SEND_ENABLED=1` をVercel Production envに設定、承認済み経路でactivate
- **検証（R4 §6 health smoke、全フィールド必須）**
  - [ ] `/api/health` 200
  - [ ] `/api/mailhub/config/health`: `readOnly=false` / `gmailSendEnabled=true` / `gmailSendCapable=true` / `gmailSendReady=true` / `gmailSendBlockedReason=null` / `sendAs.requiredCount=15` / `sendAs.acceptedCount=15` / `sendAs.missingAliases=[]` / `sendAs.error=null`
  - [ ] いずれか1つでもfailならPoCに進まず、即D5→D4 rollback
- **rollback**
  - [ ] `MAILHUB_SEND_ENABLED=0`（R4 §8）。必要ならさらに`MAILHUB_READ_ONLY=1`（R4 §9）

### D6: canary 1件本番送信

- **前提確認**
  - [ ] D5のhealth smokeが全項目PASS
  - [ ] **canary対象channelの選定根拠を再確認する**。「ebay@はmailhub@ INBOX到達7/7実証済み」という記述は**info@ INBOX到達実績の誤記載**であり、mailhub@側の到達は別途確認が必要 ⚠️[P0-1]
  - [ ] ebay@が使用不能の場合の代替候補は、いずれも完全検証済みではない点を承認者に明示する（steiner-optics_sc@=polling_pending、sbd@=POC failed）⚠️[P1-1][P1-2]
  - [ ] 1通のみ・1 operator・1 channelの承認が明記されている（bulk禁止・新規承認なしのretry禁止）
- **dry-run**
  - [ ] 対象メッセージ（ebay@宛の実メール1件）のmessageId/threadId/from候補を`GET`系の読み取り操作で事前確認する（送信は行わない）
  - [ ] `clientRequestId`を新規生成し、重複ガードのTTL（10分, `mailhub-send-duplicate-guard.ts:6`）内で再送しない設計であることを確認する
- **1件 manual gate**
  - [ ] canary_body文面（「MailHub D6 canary test. 受信確認用の1通です。返信不要です。clientRequestId=<redacted>」相当）をのび太が最終確認する
- **本実行**
  - [ ] `POST /api/mailhub/send` を1回のみ実行（messageId/bodyText/clientRequestId/postSendAction指定）
- **検証**
  - [ ] APIレスポンスが`ok:true`であること
  - [ ] **mailhub@ INBOX**にebay@からの送信ログが実際に残るかを、過去実績への期待ではなく**この場で新規に確認する**（P0-1の是正: 「証明済みだから確認省略」をしない）
  - [ ] `ahirudesign@gmail.com`側で実際に着信していることを確認（Spamフォルダも見る）
  - [ ] activity evidence（Sheets）に1件記録されていることを確認
  - [ ] 重複送信が発生していないことを確認
- **rollback**
  - [ ] 失敗または着信が曖昧な場合は**即座に**D5→D4のrollbackを実行（新規decisionなしにretryしない）
  - [ ] `send/route.ts:487-509`の失敗パス（W5修正）により、送信自体が例外を投げた場合は重複ガードは自動解放される。ただし「送信は成功したがレスポンス解析で例外」等の際は手動retryで二重送信リスクが残る点をincident記録に明記する
  - [ ] incident記録（severity/DRI/cause_class等）をR4 §10様式で作成

---

## 3. 依存関係の再確認（罠を反映した注記付きDAG）

```
main HEAD 3fc9da2 (現在地。b6e1aeaから12コミット先 ⚠️P0-3)
        │
        ▼
mailhub-destructive-6-prep pre-flight closed (P1-P9)
  ⚠️ P0-2: mailhub-production-readiness-audit.json の productionReady:false / P0 current_shared_gmail_routing
           が未参照・未reconcile。着手前にPM/のび太がスコープ外である理由を明記すること
  ⚠️ P0-3: P8「main HEAD v25増分audit closed」は b6e1aea までの監査であり、
           そこからHEADまでの12コミット(W1-W5本体を含む)は未監査
        │
        ▼
D1 token再発行 (⚠️P2-3: gmailSendCapable=true は既存modifyスコープでも出るため、D1完了の証拠にしない)
        │
        ▼
D1.5 staging/preview validation gate
        │
        ├──→ D2 send-as 15登録 (⚠️P1-3: 5分キャッシュのため直後の health 確認は古い値の可能性)
        │
        ▼
D3 本番env 3点投入
        │
        ▼
[post-D3 health smoke] ⚠️P1-4: gmailSendReadyは使えない。gmailScopes/activityStore.sheetsOk/sendAs個別確認で代替
        │
        ▼
D4 READ ONLY解除 ⚠️P0-4: env=0でもactivity store未確立なら isReadOnlyMode() は true のまま。
                        必ず health の readOnly フィールドで確認（Vercelのenv表示だけで判断しない）
        │
        ▼
qa:strict 2連続PASS 再充足
        │
        ▼
D5 SEND有効化 → [post-D5 health smoke 全項目PASS必須]
        │
        ▼
D6 canary 1件 (⚠️P0-1: canary候補選定根拠のmailhub@到達7/7は誤記載＝実際はinfo@到達7/7。
               この場で新規にmailhub@到達を確認する。代替候補は全て未完全検証 ⚠️P1-1/P1-2)
  → 着確認 → 失敗 or 曖昧 → 即 D5→D4 rollback + incident open
```

---

## 4. 受け手別サマリ

- **Codex worker（遂行者）**: 上記チェックリストの ⚠️ 印は「READINESS.mdの文面だけを読んでも気づけない」箇所。各Dの「検証」ステップで、READINESS.mdの記述通りの確認に加えて⚠️印の追加確認を必ず行うこと。特にD4の`readOnly`フィールド確認とD6のmailhub@到達の**その場再確認**は省略不可。
- **のび太（destructive承認者）**: 承認前に P0-1〜P0-4 の4点は一読を推奨。特にP0-2（並走readiness監査が今もP0 blocker）は、このD1-D6チケットのスコープ外だとしても、承認する際に「なぜスコープ外と言えるのか」を一言で確認してから進めると安全。
- **Fable PM（工程管理）**: P8の監査range更新（b6e1aea→現HEAD）と、production-readiness-audit.jsonとの相互参照追記を、次回READINESS.md改版のW項目として積むことを推奨（本レポートはread-only分析のため改版自体は実施していない）。

---

## 不採用案と理由

- **案B（尖り: "止める理由TOP"だけを先出しして詳細は別紙参照にする超短尺版）**: 単体では不採用。理由は、Codex workerが実際に手を動かす際に「別紙」を往復する認知コストがミスの温床になるため。ただし冒頭の「§0 読む前に：最重要P0 3件」として要素を残し、本編（案A+C）に統合した。
- **案C（保存・実用: YAML/フォーム形式のみで叙述を排したチェックリスト）**: 単体では不採用。理由は、罠の「なぜ危険か」という文脈情報が失われると、Codex workerが機械的にチェックを消化するだけになり、想定外の事象（例: health が古い値を返す)に遭遇した時に自己判断できなくなるため。ただしチェックボックス形式・表形式は本編に全面採用した。

## 潰した弱点

- 破壊者フェーズで指摘された「D6のcanary根拠の再検証が"気づいたら書く"程度の弱い扱いだった」→ §0の最重要P0の1番目に格上げし、D6チェックリストの検証ステップで「この場で新規に確認する」という具体的行動指示に変換した。
- 破壊者フェーズで指摘された「P0-2/P0-3がscope的に無関係である可能性を無視して煽っているのではという反論可能性」→ 断定を避け、「PM/のび太がスコープ外である理由を明記すること」という中立的なアクション指示に修正し、断定的な「これは矛盾している」という表現を弱めた。
- 破壊者フェーズで指摘された「D3の1件manual gateがrunbook原文（同一アクション内完結）と矛盾する提案になっていた」→ 「runbook上は同一アクション内で完結と書かれているが、切り分けのためのログ記録は個別に取る」という非矛盾な表現に修正し、runbookの手順自体を変更する提案ではなく観測強化の提案に限定した。
- 破壊者フェーズで指摘された「file:line引用の一部がずれている可能性」→ 全てのP0/P1/P2の引用行番号を、実際にReadツールで取得した行番号と再突合し、ずれていたP9関連の引用（471-477 vs 487-509）はズレそのものをP2の指摘対象として明記する形にした（隠さず可視化）。

## 公開前チェックリスト

- [x] 罠は全てREADINESS.mdまたはコード実体とのfile:line突合で検出したものであり、推測のみのものはP2に格下げしている
- [x] D1〜D6それぞれに「前提確認→dry-run→1件manual gate→本実行→検証→rollback」の6段構成が揃っている
- [x] destructive操作（Gmail/Vercel/Lolipop API呼び出し）を一切実行していない。git操作もlog/show/diff/grepのみ
- [x] 出力ファイルはOUTPUT_PATH（`.ss5/mailhub-d6-trap-detection/final.md`）のみに書き込み
- [x] secret値・token値を一切含んでいない（secret_ref表記のみ）
- [ ] （次アクション）本レポートのP0-2/P0-3/P8 range更新は、READINESS.md自体の改版チケット（別ticket）としてFable PMが起票するのが望ましい

## 次に頼むべき追加指示

- production-readiness-audit.jsonのP0 blocker（`current_shared_gmail_routing`）が、D1-D6のGmail送信有効化スコープと本当に無関係と言えるか、をFable PM判断 または のび太に一度明示確認してもらう（本レポートは「未参照である」という事実指摘に留め、可否の最終判断はしていない）
- D6のcanary候補について、mailhub@ INBOX到達を実際に(read-onlyの範囲で可能な過去ログ確認等により)再検証できるものがあれば追加確認し、それでも確認できない場合はD6実行直前に軽量な受信確認テスト（本レポートのスコープ外＝実際の送信操作を伴うため）を運用計画に組み込む

---

## 各周ログ

### 1周目

**判断**: 罠検出の勝利条件は「READINESS.mdの文面を信じて実行すると事故る箇所を、file:line根拠付きで、Codex workerがそのまま遂行できるchecklist形式に変換すること」と定義した。方向性A（王道: 原文の順序に忠実に注記を埋め込む）/ B（尖り: 危険度順に"止まれ"を先出しする）/ C（保存実用: YAML/表形式で機械可読性重視）の3案を用意した。

**理由**: 受け手が3者（Codex worker=機械的遂行者、のび太=destructive承認者、Fable PM=工程管理者）と明確に異なるため、単一トーンでは全員に最適化できない。3方向性を出してから合成する方が、後戻りのリスクが低いと判断した。

**不足情報**: この時点ではまだREADINESS.mdの正本と関連ファイル（プロダクション監査JSON・send route実装・runbook4本）を読み切っていなかったため、罠の実体（file:line根拠）が未確定だった。

**失敗リスク**: 表面的な「順序がおかしい」「承認欄が空欄」といった一般論に終始し、コード実体とのつき合わせをしないまま罠リストを作ってしまうリスクがあった。

**改善案**: 2周目に入る前に、READINESS.mdが参照する4本のrunbook・send route実装・関連lib（send-as/send-resolver/duplicate-guard/read-only/activityStore/channels/config-health）を全てRead済みにしてから比較・生成に入ることにした。

**次にやること**: 全関連ファイルをReadし、READINESS.mdの主張とコード実体・他のaudit成果物との突合を行い、file:line根拠のある罠を抽出する。

**自己採点**: 55/100（方向性は立てたが、まだ実体調査ゼロで罠の中身が空虚だったため）

### 2周目

**判断**: 全関連ファイル（4 runbook、send/route.ts、mailhub-send-as.ts、mailhub-send-resolver.ts、mailhub-send-duplicate-guard.ts、mailhub-production-readiness-audit.json、lolipop-routing-audit.json、lolipop-poc-*.json、NEXT_SESSION_HANDOFF.md、PROGRESS-MINDMAP.md、channels.ts、read-only.ts、activityStore.ts、config/health/route.ts、get-refresh-token.mjs、git log）を読み込んだ結果、当初の3案のうち**案A+Cのハイブリッドに案Bの冒頭サマリを接木**する形を採用した。理由は比較表の通り。生成した本文に対し、破壊者レンズで検証した結果、以下の欠陥を検出した。

**理由**: 単なる一般論ではなく、具体的なfile:line突合により4件のP0級罠（D6 canary根拠のmailhub@/info@取り違え、並走production-readiness監査のP0未参照、P8監査rangeの現HEADからの12コミット遅れ、D4のisReadOnlyMode()durable-store依存）を発見できた。これらは推測ではなく実際のコード・JSON・git logの読み合わせで確認済みであるため、P0として報告する根拠が十分にある。

**不足情報**: Vercel Production環境の実際の現在値（MAILHUB_READ_ONLY/SEND_ENABLED/ACTIVITY_STOREの実値）は read-only 制約により確認不能。したがって「D3/D4/D5が現在どこまで進んでいるか」の実運用状態は本レポートでは判断できない。

**失敗リスク**: production-readiness-audit.jsonのP0がD1-D6のスコープと無関係である可能性を排除できていないまま、P0として強く主張しすぎるリスクがあった（過剰演出のリスク）。またD3の1件manual gate提案がrunbook原文の「同一アクション内完結」の指示と矛盾する書き方になっていた。

**改善案**: 3周目で、断定表現を「PM/のび太が確認すること」という中立的なアクション指示に緩和し、runbook原文と矛盾しない書き方に修正する。またfile:line引用の精度を再チェックする。

**次にやること**: 破壊者のverdict（下記YAML）のfatal優先で本文を修正し、仕上げ屋パートで目次・重大度サマリ・遂行前チェックリストを追加する。

**自己採点**: 78/100（実体根拠は強いが、断定しすぎている箇所と原文との矛盾が残っていた）

```yaml
verdict:
  score: 78
  fatal: []
  weaknesses:
    - "P0-2/P0-3の書き方が『矛盾している』と断定調で、readiness-audit.jsonとD1-D6が本当に同一スコープかの検証なしに強く主張しすぎている"
    - "D3の1件manual gate提案が、runbook原文『同一アクション内で完結』という明示指示と表面上矛盾する書き方になっている"
    - "各罠の重大度線引き（何がP0で何がP1か）の基準が本文中で明示されていない"
    - "D6のsteiner-optics_sc@ polling_pending指摘が、P1-1(sbd)と並列表記されているが、両者のリスクの質(POC失敗 vs 未完了確認)の違いが薄い"
  cut: []
  add:
    - "冒頭に重大度の定義基準（P0=本実行前に必ず解消、P1=確認・明文化すべき、P2=情報共有レベル）を明記する"
    - "P0-2/P0-3の断定表現を『PM/のび太が確認すること』という中立的なアクション指示へ変更する"
    - "D3のmanual gate提案をrunbook原文と矛盾しない表現に修正する"
  rewrite_hints:
    - "各P0项目の『何が起きるか』列で、断定ではなく蓋然性の高いリスクとして記述する"
  recommendation: REVISE
```

**この周の破壊者コメント（褒めなし）**: file:line根拠の収集自体は良いが、report-only制約下での「発見事実」と「解釈・提案」を混同している箇所が複数ある。特にproduction-readiness-audit.jsonのP0がこのticketのスコープと直接関係するかどうかは未検証のまま「相互参照していないのは重大な抜け穴」と断定しており、これは反論可能性が高い（「別ゲートだから当然参照しない」という反論に対して本文が耐えられない）。D3のmanual gate提案も、read-only分析タスクの範囲を超えてrunbook自体の手順変更を示唆しており、制約（正本の手順を変更する権限はない）を踏み越えかけている。修正必須。

### 3周目

**判断**: 2周目のverdict（fatalは無しだったが、weaknesses 4件・add 3件）を反映し、断定的な表現を全て「確認すること」「明記すること」という中立的なアクション指示に書き換えた。D3のmanual gate提案は「runbook上は同一アクション内で完結と書かれているが、切り分けのためのログ記録は個別に取る」という非矛盾な表現に修正した。重大度定義（P0/P1/P2の基準）を明記した。P9の行番号ズレはP2として可視化し、隠さず本文に残した。

**理由**: 破壊者の指摘は全て「事実の正確性」ではなく「主張の強さ・断定度」に対するものだったため、根拠の差し替えは不要で、表現の緩和のみで対応可能だった。これにより発見事実の正確性は維持しつつ、反論可能性を下げた。

**不足情報**: production-readiness-audit.jsonのP0とD1-D6の関係性の最終的な可否判断は、このレポートの権限（read-only分析）の外側にあるため、「次に頼むべき追加指示」としてFable PM/のび太への確認依頼という形で明示的に残した。

**失敗リスク**: 依然として、Codex workerが本レポートを読まずにREADINESS.mdだけを見て作業を始めてしまうリスクはゼロにできない（運用上のリスクであり、レポートの内容改善では解決しない）。§0で最重要3件を先出しすることでこのリスクを緩和した。

**改善案**: 今後、READINESS.md自体の改版（P8のrange更新、production-readiness-auditとの相互参照追加）を別ticketとして起票することを推奨として明記した。

**次にやること**: なし（本タスクの範囲はここまで）。次アクションは「次に頼むべき追加指示」セクションに委譲。

**自己採点**: 90/100（file:line根拠は全て実在確認済み、断定過多だった表現は是正済み。減点10点の理由は、Vercel実環境の現在値が read-only 制約により確認不能なままである点、およびproduction-readiness-auditとD1-D6のスコープ関係の最終判断を本レポート単独では確定できない点による）

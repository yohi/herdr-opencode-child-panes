# V1 エンドツーエンド検証 — oh-my-openagent v4.19.4

issue #13 の検証エビデンス: Herdr 内で動作する OMO (oh-my-openagent) v4.19.4 環境において、実際の OpenCode イベントから実際の子ペインを駆動した結果を記録する。

**総合ステータス: `NOT RUN`。** まだシナリオの観測結果は存在しない。各シナリオには正確な手動手順を記録しており、後日の実行と結果の追記が可能。理由は[シナリオを実行しなかった理由](#シナリオを実行しなかった理由)を参照。

## 環境

| コンポーネント | バージョン / 識別子 | 出所 |
| --- | --- | --- |
| OMO (oh-my-openagent) | v4.19.4 タグ | 検証時点でインストール済みのパッケージ |
| Herdr | 0.9.0 (`herdr --version`) | インストール済みバイナリ |
| OpenCode | 1.18.30 (`opencode --version`) | インストール済みバイナリ |
| プラグイン | v0.1.0、ソースコミット `bf0285e`（PR3 の HEAD） | `feat/v1-verification-documentation` |
| Node.js | v26.8.1 | 単体検証に使用したランタイム |
| npm | 11.19.0 | パッケージマネージャ |

PR4 ブランチはテスト・CI・ドキュメントの追加のみで、ランタイムコードはコミット `bf0285e` と同一である。したがって `bf0285e` が検証対象のプラグインバージョンとなる。

## 設定

検証ランで使用（推奨）する環境。以下は OpenCode 起動前に実行する。プラグイン自体にクレデンシャルは不要。OpenCode サーバーをパスワード保護する場合、`OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` は環境からアタッチプロセスへ継承されるが、ポリシーによりここでは秘匿する。

```sh
# Herdr がペイン内に自動設定する値（確認のみ行い、ハードコードしない）:
#   HERDR_ENV=1
#   HERDR_PANE_ID=<呼び出し元ペインID>

# プラグインのスイッチ（既存値を優先して OpenCode へ継承する）:
export HERDR_CHILD_PANES="${HERDR_CHILD_PANES:-true}"
export HERDR_CHILD_PANES_MAX="${HERDR_CHILD_PANES_MAX:-4}"
export HERDR_CHILD_PANES_IDLE_MS="${HERDR_CHILD_PANES_IDLE_MS:-10000}"
export HERDR_CHILD_PANES_DIRECTION="${HERDR_CHILD_PANES_DIRECTION:-auto}"
export HERDR_CHILD_PANES_DEBUG="${HERDR_CHILD_PANES_DEBUG:-true}"
```

## 共通セットアップ

検証セッションごとに一度実行する:

1. プラグインをビルドし、OpenCode コンパニオンプラグインとしてインストールする:

   ```sh
   npm ci
   npm run build
   cp -r dist <opencode-plugins-dir>/herdr-opencode-child-panes
   ```

2. OpenCode 統合を Herdr にインストールする（一度だけ）:

   ```sh
   herdr integration install opencode
   ```

3. Herdr を起動し、インタラクティブシェルのプロンプト状態のペインを開き、その中で OpenCode を起動する:

   ```sh
   herdr pane list              # 新しいペインの ID を控える
   herdr agent start main --kind opencode --pane <PANE_ID>
   ```

4. ペインのシェルで、OpenCode を起動する前にペイン環境を確認し、プラグインのスイッチをエクスポートする:

   ```sh
   test "${HERDR_ENV:-}" = 1 && echo "HERDR_ENV ok"
   test -n "${HERDR_PANE_ID:-}" && echo "HERDR_PANE_ID=$HERDR_PANE_ID"
   export HERDR_CHILD_PANES="${HERDR_CHILD_PANES:-true}"
   export HERDR_CHILD_PANES_MAX="${HERDR_CHILD_PANES_MAX:-4}"
   export HERDR_CHILD_PANES_IDLE_MS="${HERDR_CHILD_PANES_IDLE_MS:-10000}"
   export HERDR_CHILD_PANES_DIRECTION="${HERDR_CHILD_PANES_DIRECTION:-auto}"
   export HERDR_CHILD_PANES_DEBUG="${HERDR_CHILD_PANES_DEBUG:-true}"
   ```

5. その OpenCode セッションで OMO v4.19.4 を起動する（ペインと同じ OpenCode サーバーに接続する）。

6. 実行中の検証ツール:

   ```sh
   herdr pane get "$HERDR_PANE_ID"            # 呼び出し元ペインのルートセッション ID
   herdr pane layout --pane "$HERDR_PANE_ID"  # 子ペイン・フォーカス・agent_session ID
   herdr pane read --pane "$HERDR_PANE_ID"    # プラグインのデバッグログ行
   ```

記録方法: 各シナリオで、アクションの前後で `herdr pane layout --pane "$HERDR_PANE_ID"` の出力を取得し、その差分を Notes に証跡として残したうえで、Observed result を `PASS` / `FAIL` で確定する。

## シナリオ

### シナリオ 1 — 単一バックグラウンド子

- **セットアップ:** 共通セットアップ。`export HERDR_CHILD_PANES_MAX=4` を OpenCode 起動前に実行する。
- **アクション:** メインの OpenCode セッションで、バックグラウンドのサブエージェントタスクを 1 件 dispatch する（例: `/subagent explore`）。
- **期待される挙動:**
  - `session.created` 時点ではペインを分割しない。ペインは子が最初の実アクティビティを見せた後に現れる。
  - `herdr pane layout` に子ペインがちょうど 1 つ追加される。
  - 子ペインの `agent_session.value` が OMO の子セッション ID と一致する。
  - メインペインがフォーカスを保持する（`--no-focus` 分割）。
- **観測結果:** `NOT RUN`。
- **備考:** 手動実行が必要。[シナリオを実行しなかった理由](#シナリオを実行しなかった理由)を参照。

### シナリオ 2 — 並行子

- **セットアップ:** 共通セットアップ。`HERDR_CHILD_PANES_MAX` はデフォルト（4）。
- **アクション:** OMO で 3 件のサブエージェントタスクを同時に dispatch する。
- **期待される挙動:**
  - 新規子ペインは最大 `HERDR_CHILD_PANES_MAX` まで。
- 同じ `agent_session.value` を共有するペインは存在しない。
  - メインペインはフォーカスを保持する。
  - 3 件の OMO 子セッションはすべて正常完了する。
- **観測結果:** `NOT RUN`。
- **備考:** —

### シナリオ 3 — 完了時のアイドル掃除

- **セットアップ:** 共通セットアップ。猶予期間を観測可能にするため、`export HERDR_CHILD_PANES_IDLE_MS=10000` を OpenCode 起動前に実行する。
- **アクション:** サブエージェントタスクを完了まで実行して待つ。
- **期待される挙動:**
  - セッションがアクティブな間、子ペインは開いたまま。
  - 子がアイドルになった後、ペインは猶予期間の間開いたままになり、その後閉じる。
  - ペインが閉じた後も OMO タスクの結果はメインセッションから参照できる。
- **観測結果:** `NOT RUN`。
- **備考:** —

### シナリオ 4 — アイドル復帰

- **セットアップ:** 共通セットアップ。余裕を持たせて、`export HERDR_CHILD_PANES_IDLE_MS=15000` を OpenCode 起動前に実行する。
- **アクション:** 長時間のサブエージェントタスクを開始し、アイドルになったら、猶予期間が満了する前に子へ新しいメッセージを送る。
- **期待される挙動:**
  - `session.idle` がクローズ保留タイマーを設定する（状態 `idle_pending`）。
  - 新しいアクティビティがタイマーを取り消し、同じ子ペインがアタッチされたまま。
  - 同一セッションに対して 2 つ目のペインは作られない。
- **観測結果:** `NOT RUN`。
- **備考:** —

### シナリオ 5 — ごく短命な子

- **セットアップ:** 共通セットアップ。
- **アクション:** 分割・アタッチのシーケンスが完了するより速く完了するサブエージェントタスクを実行する。
- **期待される挙動:**
  - 分割の試行は多くても 1 回。
  - 子がアタッチ完了前に終了した場合、新規ペイン（存在すれば）は閉じられ、孤立ペインは残らない。
  - OMO タスクの結果は無事である。
- **観測結果:** `NOT RUN`。
- **備考:** タイミング依存。確実に再現できない場合は、試行した再現手順と観測された限界の挙動を記録する。

### シナリオ 6 — 容量超過

- **セットアップ:** 共通セットアップ + `export HERDR_CHILD_PANES_MAX=2`（OpenCode 起動前に実行）。
- **アクション:** 4 件のサブエージェントタスクを dispatch する。
- **期待される挙動:**
  - 作られる子ペインは 2 つだけ。
  - 残り 2 件の子は、理由 `capacity_limit` の `ignored` になる（プラグインのデバッグログで確認できる）。
  - 4 件の OMO タスクはすべて完了する。
  - 子ペインを 1 つ閉じると、その後に dispatch した子のために容量が解放される。
- **観測結果:** `NOT RUN`。
- **備考:** —

### シナリオ 7 — 無関係ルートの分離

- **セットアップ:** 共通セットアップに加え、同じ OpenCode サーバー上で 2 つ目の OpenCode クライアント / ルートセッションを開く（Herdr の呼び出し元ペインの外）。
- **アクション:** 2 つ目のルート配下で子セッションを作る。
- **期待される挙動:**
  - 2 つ目のルートの子は、呼び出し元ペインの子ペインとして可視化されない。
  - 呼び出し元ペインの `herdr pane layout` は自分の子孫だけを表示する。
- **観測結果:** `NOT RUN`。
- **備考:** —

### シナリオ 8 — ネストした子の階層

- **セットアップ:** 共通セットアップ。`HERDR_CHILD_PANES_MAX` はデフォルト以上。
- **アクション:** さらに別のサブエージェントを dispatch するサブエージェントタスクを dispatch する。
- **期待される挙動:**
  - 両方の子孫ペインが作られる（容量の対象）。
  - 各ペインは正しいネストしたセッション ID にアタッチする。
  - 無関係な祖先系は一切受け付けない。
- **観測結果:** `NOT RUN`。
- **備考:** —

### シナリオ 9 — 失敗の分離

- **セットアップ:** 共通セットアップに加え、`PATH` の前方に `pane split` で非ゼロ終了し、それ以外は実バイナリへフォワードする `herdr` という名のラッパースクリプトを置く。
- **アクション:** プラグインが分割を試みるようにサブエージェントタスクを dispatch する。
- **期待される挙動:**
  - メインの OpenCode セッションは応答性を維持する。
  - 子タスクは継続するか、自分の結果を報告する。
  - プラグインのログには可視化の失敗（セッションは `failed`）が現れ、子タスクの失敗としては現れない。
  - メインペインのクローズは発生しない。
- **観測結果:** `NOT RUN`。
- **備考:** シナリオ終了後、ラッパーを `PATH` から外す。

## 不変条件チェックリスト

手動ランの中で、それぞれ 1 行の証跡とともに確認する:

- [ ] メインペインは閉じず、フォーカスも失わない。
- [ ] 並行する子ペインは `HERDR_CHILD_PANES_MAX` を超えない。
- [ ] 2 つのペインが同じセッション ID にアタッチすることはない。
- [ ] アイドルクローズは設定された猶予期間の後でのみ発生し、新しいアクティビティはそれを取り消す。
- [ ] `session.deleted` はペインを速やかに閉じる。
- [ ] 閉じられるのはプラグインが作ったペインだけで、`HERDR_PANE_ID` 自体は決して閉じない。
- [ ] 無関係なルートのセッションは完全に無視される。
- [ ] Herdr CLI の失敗は OpenCode をクラッシュさせず、子タスクにも触れない。
- [ ] クレデンシャル（URL の userinfo、クエリの秘密、環境変数のパスワード）がログに現れない。
- [ ] `dispose` の後、タイマーは発火せず、アタッチ済みペインは閉じられない。

## 実施済みの自動検証

本ドキュメントが同梱されるブランチのテスト・CI・ドキュメント追加コミット `ba1c389` で以下を実行し、すべて成功:

```sh
npm run lint        # biome check — 成功
npm run typecheck   # tsc --noEmit — 成功
npm run test        # vitest run — 152 テスト / 13 ファイル、すべて成功
npm run build       # tsup esm + dts — 成功
```

単体カバレッジと issue #12 のカテゴリの対応: 設定パース（`test/config.test.ts`）、所有権と階層（`test/ownership-resolver.test.ts`、`test/root-session-resolver.test.ts`）、ライフサイクル状態機械（`test/child-session-registry.test.ts`）、並行性・容量・掃除の安全性（`test/pane-orchestrator.test.ts`、`test/async-queue.test.ts`）、セキュリティ（`test/shell-quote.test.ts`、`test/attach-launcher.test.ts`）、イベントと CLI アダプタ（`test/event-resolver.test.ts`、`test/herdr-client.test.ts`、`test/herdr-client-subcommand.test.ts`）、dispose 挙動を含むプラグインレベルのフロー（`test/index.test.ts`）。

## 統合テスト戦略

実バイナリの統合テスト層は設計上の決定として存在するが、意図的にデフォルトのゲートには含めない:

- herdr-opencode-child-panes が Herdr に対して行うすべての操作は `HerdrClient` インターフェースを経由するため、オーケストレーションロジックは完全に制御されたフェイククライアントに対して単体テストされる。デーモンなしで全分岐をカバーする。
- 残るリスクはアダプタ境界そのもの（実際の `herdr` CLI のフラグ・出力形状・終了コード）であり、これは `test/herdr-client.test.ts` が実 CLI 出力から取得したフィクスチャのパースでカバーする。さらに `HERDR_BINARY=<herdr のパス>` を設定してゲート付き統合テストを実行すれば、ライブでの確認も可能。
- 完全な E2E の挙動（上記シナリオ）は、インタラクティブな OMO 会話ループとペインの視覚確認を要求するため、自動 CI の対象外であり、本ドキュメントに手動で記録する。

## シナリオを実行しなかった理由

シナリオはライブでインタラクティブなループを要求する: Herdr セッションが OpenCode ルートペインをホストし、OMO v4.19.4 が人間の駆動する会話を通じてサブエージェントを dispatch し、ランの進行中にペインレイアウトとフォーカスを目視確認する必要がある。本検証パスは非インタラクティブな環境で作成されたため、このループを忠実に実行できなかった。シナリオは推測の結果ではなく、正確な再現手順とともに `NOT RUN` として記録する。

検証を完了するには: [共通セットアップ](#共通セットアップ)を実行し、シナリオを順にたどり、各 `NOT RUN` を `PASS` か `FAIL` に置き換え、[不変条件チェックリスト](#不変条件チェックリスト)にチェックを入れる。

## 既知の制限

- アイドル猶予タイマーはメモリ上にある。OpenCode の再起動で保留タイマーは失われる（アタッチ済みペインは、セッションが削除されるか再びアイドルするまで開いたまま）。
- 対応する分割方向は `right` / `down` のみ（Herdr の対応方向）。
- `message.part.delta` イベントは防御的に処理するが、現行 SDK のイベント union には含まれない。
- ネストした子は同じ容量上限を共有し、深さ優先の可視化順序は保証されない。
- 上記 9 シナリオはすべて手動インタラクティブランが未実施。単体とビルドの検証は完了しているが、ライブの E2E エビデンスはまだ存在しない。

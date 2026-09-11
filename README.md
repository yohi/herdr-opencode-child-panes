# herdr-opencode-child-panes

[OpenCode](https://opencode.ai) の子セッション（サブエージェント）を [Herdr](https://github.com/herdrdev/herdr) のペインとして可視化するコンパニオンプラグインです。

Herdr のペイン内で動作する OpenCode セッションがサブエージェントを起動したとき、このプラグインは次のように振る舞います:

1. OpenCode の `session.created` イベントから子セッションを検出し、ルートセッションをホストするペイン配下かどうかを判定する。
2. 最初の実アクティビティ（`message.updated` / `message.part.updated`）を待つ。
3. 呼び出し元ペインを分割（`herdr pane split --no-focus`）してメインペインのフォーカスを維持したまま、新しいペイン内で `opencode attach` により子セッションをアタッチする。
4. 子セッションが猶予期間を超えてアイドルするか削除されたら、ペインを閉じる。

## アーキテクチャと境界

各関心事が独立してテスト可能になるようレイヤー化されており、プラグインは Herdr や OpenCode の内部構造に依存しません:

| モジュール | 責務 |
| --- | --- |
| `src/index.ts` | プラグインのエントリポイント。実行時前提条件のチェックと依存の組み立て。 |
| `src/config.ts` | 環境変数を型付き設定へパース。不正値はデフォルトへフォールバック。 |
| `src/child-session.ts` / `src/child-session-registry.ts` | 子セッションの状態機械とレジストリ（状態・遷移規則・タイマー）。 |
| `src/root-session-resolver.ts` | 呼び出し元 Herdr ペイン配下の OpenCode ルートセッションを解決（短期 TTL キャッシュ）。 |
| `src/ownership-resolver.ts` | 生成されたセッションが所有する子か追跡対象の子孫かを判定。 |
| `src/event-resolver.ts` | OpenCode イベントからセッション ID を抽出。未文書の形状も防御的に処理。 |
| `src/direction-policy.ts` | `auto` と現在のレイアウトから具体的な分割方向 `right`/`down` を決定。 |
| `src/shell-quote.ts` | ペイン内で実行するコマンドのシェル引用。 |
| `src/attach-launcher.ts` | `opencode attach` の構築と実行。ログからのクレデンシャル除去。 |
| `src/herdr-client.ts` | Herdr CLI のアダプタ（`pane get` / `layout` / `split` / `run` / `close`）。 |
| `src/pane-orchestrator.ts` | ライフサイクル駆動: アクティビティ起点の分割/アタッチ、アイドル掃除、リトライ、容量上限。 |
| `src/async-queue.ts` | Herdr ミューテーションを直列化し、並行イベントの交差を防ぐ。 |

制御フローにおいて OpenCode の HTTP API は使わず、`@opencode-ai/plugin` のフック経由のイベントのみを受け取ります。Herdr へのアクセスはすべて CLI アダプタ経由です。

## 要件

- Node.js 20 以降
- `herdr` が `PATH` 上にある Herdr 環境
- `session.created` / `session.status`（`idle` を含む）/ `session.idle` / `session.deleted` / `message.updated` / `message.part.updated` を報告する OpenCode（OpenCode 1.18.x で動作確認）
- プラグインは OpenCode ルートセッションをホストする Herdr ペイン内で実行されること

## インストール

### 1. Herdr 統合のインストール

ペインが OpenCode セッションをホストできるよう、OpenCode エージェントを Herdr に登録します:

```sh
herdr integration install opencode
```

### 2. OpenCode コンパニオンプラグインとしてインストール

プラグインをビルドし、`dist/` を OpenCode の設定ディレクトリ配下のプラグインディレクトリへ配置します（正確な配置先は利用中の OpenCode のプラグインドキュメントを参照してください）:

```sh
npm run build
cp -r dist <opencode-plugins-dir>/herdr-opencode-child-panes
```

OpenCode は次回のサーバー起動時にプラグインを自動読み込みします。

## 設定

設定はすべて環境変数で行います。不正な値は例外ではなくデフォルトへフォールバックします。

| 変数 | デフォルト | 説明 |
| --- | --- | --- |
| `HERDR_ENV` | （未設定） | プラグイン起動に必須。Herdr がペイン内に自動設定する。 |
| `HERDR_PANE_ID` | （未設定） | この OpenCode セッションをホストする呼び出し元ペイン ID。Herdr がペイン内に自動設定する。 |
| `HERDR_CHILD_PANES` | `true` | マスタースイッチ。`false`（または `0` / `no`）で無効化。 |
| `HERDR_CHILD_PANES_MAX` | `4` | 同時に管理する子ペインの最大数。 |
| `HERDR_CHILD_PANES_IDLE_MS` | `10000` | アイドルした子ペインを閉じるまでの猶予期間（ミリ秒）。 |
| `HERDR_CHILD_PANES_DIRECTION` | `auto` | 新規ペインの分割方向: `auto` / `right` / `down`。`auto` は横長レイアウトで `right`、それ以外で `down`。 |
| `HERDR_CHILD_PANES_DEBUG` | `false` | `true` でデバッグログを出力。 |

## ペインライフサイクルの挙動

- `session.created`: 親が呼び出し元ペインのルートセッションに解決されるセッションを `waiting_activity` として登録します。この時点ではペインを作りません。
- 最初の実アクティビティ: `--no-focus` 付きで呼び出し元ペインを分割し（メインペインはフォーカスを保持）、新しいペイン内で `opencode attach` により子セッションをアタッチします。成功すると `attached` になります。
- `session.status` の `idle` または `session.idle`: セッションは `idle_pending` に遷移し、猶予期間のクローズタイマーが設定されます。新しいアクティビティはタイマーを取り消して `attached` に戻します。同じペインがアタッチされ続け、2 つ目のペインは作られません。
- 猶予期間の経過: ペインを閉じ、セッションは `closed` になります。
- `session.deleted`: （直列化キューを介して）即座にペインを閉じます。
- クローズ失敗はバックオフ付きで有界リトライされ、リトライを使い切ると `close_failed` を理由に `failed` になります。

## 容量の挙動

- 同時に管理する子ペインの数は `HERDR_CHILD_PANES_MAX` に制限されます。
- 上限を超えた生成要求は、セッションを理由 `capacity_limit` の `ignored` に遷移させます。子セッション自体には影響せず、可視化だけがスキップされます。
- 容量はライブなペインレイアウトから数えるため、外部で閉じられたペインは容量を解放します。閉じた子ペインも新規の子のために容量を解放します。
- 生成とクローズは内部キューで直列化されるため、並行イベントで上限を超過することはありません。

## 失敗と劣化のセマンティクス

- 分割失敗: セッションは `failed` になります。子セッションは動き続け、失われるのは可視化だけです。
- アタッチ失敗: 直後に分割したペインを閉じて孤立ペインを残さず、セッションは `failed` になります。
- Herdr CLI のエラーで OpenCode がクラッシュすることはありません。プラグインは警告をログに出して子タスクに触れません。
- プラグインが閉じるのは自分が作ったペインだけで、呼び出し元ペイン（`HERDR_PANE_ID`）は決して閉じません。
- `ignored` / `failed` な親の子は可視化されません。失敗が孤立ペインへ連鎖することはありません。

## セキュリティに関する注意

- `herdr pane run` に送るコマンドはシェル引用されます。イベント由来のセッション ID やディレクトリがシェル構文を注入できません。
- アタッチのログはサーバー URL を origin までに短縮します。ユーザー名・パスワード・クエリ文字列・フラグメントがログに現れることはありません。
- `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` は環境からアタッチプロセスへ継承されますが、ログに記録されたり永続化されたりしません。
- プラグインは `HERDR_PANE_ID` 由来のペインの分割とクローズのみを行い、無関係なペインを検査・クローズしません。

## 現在の制限

- 対応する分割方向は `right` / `down` のみです（Herdr の対応方向）。
- アイドル猶予タイマーはメモリ上にあります。OpenCode 再起動時は保留タイマーが失われます（アタッチ済みペインは、セッションが削除されるか再びアイドルするまで開いたままです）。
- `message.part.delta` イベントは防御的に処理しますが、現行 SDK のイベント union には含まれません。
- 実 Herdr バイナリを使う統合テストは `HERDR_BINARY` 環境変数でゲートされ、未設定時はスキップされます。
- ネストした子セッションも追跡しますが、可視化の深さは同じ容量上限の対象で、深さ優先の順序は保証されません。

## OMO（oh-my-openagent）との関係

このプラグインは OMO のペイン可視化と同じユースケースを対象にしています: Herdr レイアウト内で複数のエージェントセッションを並行実行すること。OMO が dispatch した子セッションは Herdr ペインとして現れるため、OMO 管理の OpenCode セッションと互換です。ただし **OMO への私的依存はありません**: 公開されている OpenCode プラグインフックと公開 Herdr CLI だけを消費します。実行時に OMO は不要です。

## 開発

```sh
npm install
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # tsup build to dist/
```

## ライセンス

MIT

# アーキテクチャ

[English version](../docs/architecture.md)

> [!NOTE]
> この文書は [English version](../docs/architecture.md) の日本語訳です。
> 内容に相違がある場合は、英語版を権威あるものとします。

この文書では、`herdr-opencode-child-panes` が高レベルでどのように動作するかを説明します。正確な状態機械、遷移規則、不変条件については [SPEC.md](../SPEC.md) を参照してください。

## プラグインの機能

`herdr-opencode-child-panes` は、受け入れられた子セッション（サブエージェント）を Herdr のペインとして可視化する OpenCode コンパニオンプラグインです。Herdr ペイン内で動作する OpenCode ルートセッションがサブエージェントをディスパッチすると、プラグインはルートセッションの隣に新しいペインを作成し、その中で `opencode attach` を実行します。子セッションがアイドルになるか削除されると、ペインは自動的に閉じられます。

## Herdr + OpenCode 全体での位置づけ

このプラグインは 2 つの外部システムに依存しています。

- **Herdr** はペインレイアウトを提供します。プラグインは現在のレイアウトを読み取り、`herdr` CLI を通じて `split`、`resize`、`run`、`close` コマンドを発行します。
- **OpenCode** はセッションイベントを提供します。プラグインは `session.created`、`session.status`、`session.idle`、`session.deleted`、`message.updated`、`message.part.updated` などの `@opencode-ai/plugin` フックを購読します。

プラグインは、現在の Herdr ペインがホストするルート OpenCode セッションを識別できる場合にのみ動作します。OpenCode の HTTP API を呼び出したり、自身の `HERDR_PANE_ID` 外のペインを調査したりすることはありません。

## モジュールマップと責務

| モジュール | 責務 |
| --- | --- |
| `src/index.ts` | プラグインのエントリポイント。`HERDR_ENV` と `HERDR_PANE_ID` を検証し、依存関係を組み立てます。 |
| `src/config.ts` | 環境変数を型付き設定へパース。不正な値はデフォルトへフォールバックします。 |
| `src/child-session.ts` / `src/child-session-registry.ts` | 子セッションの状態と遷移を追跡します。 |
| `src/root-session-resolver.ts` | 現在の Herdr ペインの OpenCode ルートセッションを解決します（短期 TTL キャッシュ付き）。 |
| `src/ownership-resolver.ts` | 新しいセッションが追跡対象のルートセッションに属するかを判定します。 |
| `src/event-resolver.ts` | OpenCode イベントからセッション ID を抽出します。 |
| `src/shell-quote.ts` | `herdr pane run` へ渡すコマンドをシェル引用します。 |
| `src/attach-launcher.ts` | `opencode attach` を構築・実行し、クレデンシャルをログから除去します。 |
| `src/herdr-client.ts` | Herdr CLI へのアダプタです。 |
| `src/pane-orchestrator.ts` | 分割/アタッチ、アイドルクリーンアップ、リトライ、容量制限を駆動します。 |
| `src/async-queue.ts` | Herdr ミューテーションを直列化し、並行イベントが交差しないようにします。 |

`src/direction-policy.ts` は後方互換性のために残っていますが、固定レイアウトの子ペイン生成では使用しません。

## 制御フローの概要

1. `session.created` イベントが到着します。プラグインは親を解決し、ルートセッションに属する場合はその子を `waiting_activity` として登録します。
2. 最初の実アクティビティイベント（`message.updated` / `message.part.updated`）が到着します。
3. ペインオーケストレーターが分割/アタッチ操作をキューに入れます。
4. `src/async-queue.ts` がミューテーションを直列化します。`src/herdr-client.ts` が呼び出し元のペインを右に分割し、新しいペイン内で `opencode attach` を実行します。
5. アクティビティが停止し、アイドルイベントが到達すると、オーケストレーターは設定された猶予期間後にクローズをスケジュールします。
6. 新しいアクティビティでクローズタイマーがキャンセルされます。`session.deleted` イベントでは即座にペインが閉じられます。

## OMO との関係

このプラグインは、OMO のペイン可視化と同じユースケースを対象にしています: Herdr レイアウト内で複数のエージェントセッションを並行実行すること。OMO がディスパッチしたセッションは通常の OpenCode 子セッションとして現れるため、このプラグインと互換性があります。OMO への私的依存はありません。実行時にプラグインが消費するのは、公開されている OpenCode プラグインフックと公開 Herdr CLI のみです。

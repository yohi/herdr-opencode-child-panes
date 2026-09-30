# アーキテクチャ

[English version](../docs/architecture.md)

> [!NOTE]
> この文書は [English version](../docs/architecture.md) の日本語訳です。
> 内容に相違がある場合は、英語版を権威あるものとします。

この文書では、`herdr-opencode-child-panes` が高レベルでどのように動作するかを説明します。正確な状態機械、遷移規則、不変条件については [SPEC.md](../SPEC.md) を参照してください。

## プラグインの機能

`herdr-opencode-child-panes` は、受け入れられた子セッション（サブエージェント）を Herdr のペインとして可視化する OpenCode コンパニオンプラグインです。Herdr ペイン内で動作する OpenCode ルートセッションがサブエージェントをディスパッチすると、プラグインはルートセッションの隣に新しいペインを作成し、その中で `opencode attach` を実行します。子セッションがアイドルになった場合、ペインは閉じられますが、OpenCode の子セッション自体は停止しません。同じ子セッションが後から再開した場合、プラグインは同じセッションに新しいペインを作成して再び可視化します。子セッションが削除されると、可視化は完全に終了します。

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
| `src/child-session.ts` / `src/child-session-registry.ts` | 子セッションの状態、遷移、クローズメタデータ (`closeReason`, `reopenRequested`) を追跡します。 |
| `src/root-session-resolver.ts` | 現在の Herdr ペインの OpenCode ルートセッションを解決します（短期 TTL キャッシュ付き）。 |
| `src/ownership-resolver.ts` | 新しいセッションが追跡対象のルートセッションに属するかを判定します。 |
| `src/event-resolver.ts` | OpenCode イベントからセッション ID を抽出します。 |
| `src/shell-quote.ts` | `herdr pane run` へ渡すコマンドをシェル引用します。 |
| `src/attach-launcher.ts` | `opencode attach` を構築  実行し、クレデンシャルをログから除去します。 |
| `src/herdr-client.ts` | Herdr CLI へのアダプタです。 |
| `src/pane-orchestrator.ts` | 分割/アタッチ、アイドルクリーンアップ、リトライ、容量制限、再開の引き継ぎを駆動します。 |
| `src/async-queue.ts` | Herdr ミューテーションを直列化し、並行イベントが交差しないようにします。 |

`src/direction-policy.ts` は後方互換性のために残っていますが、固定レイアウトの子ペイン生成では使用しません。

## 制御フローの概要

1. `session.created` イベントが到着します。プラグインは親を解決し、ルートセッションに属する場合はその子を `waiting_activity` として登録します。
2. 最初の実アクティビティイベント（`message.updated`、`message.part.updated`、`message.part.delta`）が到着します。
3. ペインオーケストレーターがセッションを獲得 (`spawning`)、容量を予約し、分割/アタッチ操作をキューに入れます。
4. `src/async-queue.ts` がミューテーションを直列化します。`src/herdr-client.ts` が呼び出し元のペインを右に分割し、新しいペイン内で `opencode attach <session-id>` を実行します。
5. アクティビティが停止し、アイドルイベントが到達すると、オーケストレーターはセッションを `idle_pending` に遷移させ、設定された猶予期間後にクローズをスケジュールします（まだ `spawning` の段階でアイドルが到着した場合はアタッチ完了時に遅延クローズがスケジュールされます。アクティブステータスはこの遅延クローズを解除しますが、メッセージアクティビティは解除しません）。
6. 猶予期間中にアクティブステータスを受信すると、タイマーがキャンセルされ、セッションは `attached` に戻ります。意味のあるアクティビティを受信すると、既存のスケジュールされたクローズはそのまま維持されます。
7. 猶予期間が満了すると、ペインは閉じられ、セッションは `reopenable` になります。同じ OpenCode 子セッションが後から作業を再開し、再び可視化されることがあります。
8. `session.deleted` は可視化を完全に終了させ、最終的に `closed` になります。

### アイドルクローズと同じセッションの後続作業

- アイドルクリーンアップは、管理対象のペインのみを閉じます。基盤となる OpenCode 子セッションには影響しません。
- アイドルクローズ実行中に作業信号（アクティブステータスまたは意味のあるアクティビティ）を受信すると、`reopenRequested=true` が記録されます。クローズが完了すると、オーケストレーターはセッションを `reopenable` に遷移させ、同じ `sessionId` の再開スポーンを即座にキューに入れます。
- 再開スポーンは、クローズを処理したものと同じ `AsyncQueue` に追加されます。クローズタスクは再開タスクを待たず、自己デッドロックを起こすことなく、キューの順序によって後続の再開がクローズ確定後に実行されることが保証されます。
- アイドルクローズ実行中に後からアイドル信号を受信すると、`reopenRequested` はクリアされ、クローズは即時再開なしで `reopenable` に終了します。
- アイドルクローズ実行中に `session.deleted` を受信すると、クローズは永続的な削除クローズに昇格します。セッションは `reopenable` ではなく `closed` に終了します。

## 永続的な削除

`session.deleted` は不可逆な境界です。

- 登録済みのセッションは `closing` を経て最終状態 `closed` に移行します。
- `reopenable` なセッションも `closing` を経て `closed` に移行し、再開はできません。
- 所有権解決中に削除されたセッションはオーケストレーター破棄（`dispose()`）まで墓碑（tombstone）として保持され、解決完了時の登録やペイン生成を阻止し、遅延作業シグナルや重複 `session.created` による復活も完全に防ぎます。

## OMO との関係

このプラグインは、OMO のペイン可視化と同じユースケースを対象にしています: Herdr レイアウト内で複数のエージェントセッションを並行実行すること。OMO がディスパッチしたセッションは通常の OpenCode 子セッションとして現れるため、このプラグインと互換性があります。OMO への私的依存はありません。実行時にプラグインが消費するのは、公開されている OpenCode プラグインフックと公開 Herdr CLI のみです。

# 設定

[English version](../docs/configuration.md)

> [!NOTE]
> この文書は [English version](../docs/configuration.md) の日本語訳です。
> 内容に相違がある場合は、英語版を権威あるものとします。

プラグインのすべての設定は環境変数から読み込まれます。不正な値は例外を投げずに文書化されたデフォルト値へフォールバックします。実行時の前提条件やセットアップについては [getting-started.md](../docs/getting-started.md) を参照してください。

## 必須の環境変数

| 変数 | 説明 |
| --- | --- |
| `HERDR_ENV` | Herdr 環境を識別します。プラグインの読み込みに必須です。Herdr がペイン内に自動設定します。 |
| `HERDR_PANE_ID` | この OpenCode ルートセッションをホストする Herdr ペインの ID です。Herdr がペイン内に自動設定します。 |

いずれかの変数が欠けている場合、プラグインは初期化されません。

## オプションの環境変数

| 変数 | デフォルト | 有効な値 | 説明 |
| --- | --- | --- | --- |
| `HERDR_CHILD_PANES` | `true` | `true`、`false`、`0`、`1`、`yes`、`no` | マスタースイッチ。`false`、`0`、`no` とパースされる値は子ペイン可視化を無効化します。 |
| `HERDR_CHILD_PANES_MAX` | `4` | 正の整数 | 同時に管理する子ペインの最大数。 |
| `HERDR_CHILD_PANES_IDLE_MS` | `10000` | 非負整数（ミリ秒） | アイドルな子ペインを閉じるまでの猶予期間。 |
| `HERDR_CHILD_PANES_DIRECTION` | `auto` | `auto`、`right`、`down`、`up`、`left` | 後方互換性のためにパースされます。固定レイアウトでは最初の子を右方向に、追加の子を右カラム内で下方向に分割するため、この値はレイアウトに影響しません。 |
| `HERDR_CHILD_PANES_DEBUG` | `false` | `true`、`false`、`0`、`1`、`yes`、`no` | `true`、`1`、`yes` とパースされるとデバッグログを有効化します。 |

## フォールバック動作

- 数値変数に対する非整数値は無視され、デフォルト値が使用されます。
- `HERDR_CHILD_PANES_MAX` と `HERDR_CHILD_PANES_IDLE_MS` の負の値は無視され、デフォルト値が使用されます。
- 認識されない真偽値文字列はデフォルト値にフォールバックします。
- 空の値は未設定として扱われ、デフォルト値にフォールバックします。

## セキュリティへの影響

- `HERDR_ENV` と `HERDR_PANE_ID` は、信頼できないソースではなく Herdr によって提供されなければなりません。
- `HERDR_CHILD_PANES_DEBUG` を有効にすると詳細なログが出力される可能性があります。セッション ID やペイン内容が機密性を持つ環境では有効化しないでください。
- プラグインは `OPENCODE_SERVER_PASSWORD` や `OPENCODE_SERVER_USERNAME` を直接読み取ることはありません。これらは `opencode attach` 子プロセスへのみ継承されます。

## 設定例

```sh
export HERDR_CHILD_PANES=true
export HERDR_CHILD_PANES_MAX=4
export HERDR_CHILD_PANES_IDLE_MS=10000
export HERDR_CHILD_PANES_DEBUG=false
```

再起動に関する特別な設定は不要です。変更は次回の OpenCode 起動時に反映されます。

# herdr-opencode-child-panes

[English](README.md)

> [!NOTE]
> この文書は [English version](README.md) の日本語訳です。
> 内容に相違がある場合は、英語版を権威あるものとします。

[![CI](https://github.com/yohi/herdr-opencode-child-panes/actions/workflows/ci.yml/badge.svg)](https://github.com/yohi/herdr-opencode-child-panes/actions/workflows/ci.yml)
[![Release](https://github.com/yohi/herdr-opencode-child-panes/actions/workflows/release.yml/badge.svg)](https://github.com/yohi/herdr-opencode-child-panes/actions/workflows/release.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[OpenCode](https://opencode.ai) の子セッション（サブエージェント）を [Herdr](https://github.com/herdrdev/herdr) のペインとして可視化するコンパニオンプラグインです。

Herdr のペイン内で動作する OpenCode セッションがサブエージェントを起動すると、このプラグインは `session.created` からそれを検出し、最初の実アクティビティを待ってから呼び出し元のペインを右に分割し、`opencode attach` で子セッションをアタッチします。追加の子ペインは右カラム内に積み重なります。子セッションがアイドルまたは削除されると、そのペインは自動的に閉じられます。

## クイックスタート

### 要件

- Node.js 20 以降
- `PATH` 上に `herdr` があること
- このプラグインが消費するプラグインフックを備えた OpenCode 1.17.x 以降
- このプラグインが、OpenCode ルートセッションをホストする Herdr ペイン内で実行されること

### インストール

1. OpenCode エージェントを Herdr に登録します:

   ```sh
   herdr integration install opencode
   ```

2. プラグインをビルドし、OpenCode のプラグインディレクトリへ配置します:

   ```sh
   npm run build
   cp -r dist <opencode-plugins-dir>/herdr-opencode-child-panes
   ```

3. OpenCode を再起動します。次に Herdr ペイン内のルートセッションがサブエージェントを起動したとき、プラグインは子ペインを作成してアタッチします。

## 機能

- OpenCode のイベントから子セッションを検出し、HTTP API 呼び出しは不要
- 呼び出し元のペインを分割し、`opencode attach` で子セッションをアタッチ
- 複数の子ペインを固定された右カラムレイアウトで積み重ねる
- アイドルまたは削除された子ペインを自動的に閉じる
- 設定可能な子ペインの最大数を順守する
- 失敗を隔離し、Herdr CLI のエラーが OpenCode をクラッシュさせない
- OMO がディスパッチしたセッションと互換があり、OMO への私的依存なし

## 動作の仕組み

このプラグインは `@opencode-ai/plugin` のフック経由で OpenCode イベントを受け取り、薄いアダプタを通じて Herdr CLI を駆動します。子セッションの小さなレジストリを保持し、アクティビティ開始時にペインを分割し、アイドル時や削除時にクリーンアップします。モジュールマップ、制御フロー、設計不変条件については [docs/architecture.md](docs/architecture.md) を参照してください。

## 使い方

プラグインをインストールしたら、Herdr ペイン内で通常通り OpenCode を使います。例えば、エージェントにサブエージェントをディスパッチするよう依頼します:

```text
Use a subagent to summarize README.md.
```

サブエージェントが起動すると、右側に新しいペインが表示され、`opencode attach <child-session-id>` を実行します。メインペインはフォーカスを維持します。子セッションがアイドルになるか削除されると、そのペインは自動的に閉じられます。

## 設定

設定は環境変数から読み込まれます。不正な値は例外を投げずにデフォルト値へフォールバックします。

| 変数 | デフォルト | 説明 |
| --- | --- | --- |
| `HERDR_ENV` | （未設定） | 必須。Herdr がペイン内に自動設定します。 |
| `HERDR_PANE_ID` | （未設定） | 必須。この OpenCode セッションをホストするペイン ID。Herdr が自動設定します。 |
| `HERDR_CHILD_PANES` | `true` | マスタースイッチ。`false`、`0`、`no` で無効化します。 |
| `HERDR_CHILD_PANES_MAX` | `4` | 同時に管理する子ペインの最大数。 |
| `HERDR_CHILD_PANES_IDLE_MS` | `10000` | アイドルな子ペインを閉じるまでの猶予期間（ミリ秒）。 |
| `HERDR_CHILD_PANES_DEBUG` | `false` | `true` にするとデバッグログを出力します。 |

環境変数の完全なリファレンスとフォールバック動作については [docs/configuration.md](docs/configuration.md) を参照してください。

## ドキュメント

| ドキュメント | 目的 |
| --- | --- |
| [README.ja.md](README.ja.md) | この README の日本語訳。 |
| [docs/getting-started.md](docs/getting-started.md) | 詳細なセットアップ、前提条件、初回実行の確認。 |
| [docs/architecture.md](docs/architecture.md) | 高レベルアーキテクチャ、モジュールマップ、制御フロー。 |
| [docs/configuration.md](docs/configuration.md) | 設定の完全なリファレンス。 |
| [docs/operations.md](docs/operations.md) | 運用マニュアル: アイドル動作、容量制限、失敗、トラブルシューティング。 |
| `SPEC.md` | 技術仕様（ライフサイクル、失敗のセマンティクス、不変条件）。 |
| `AGENTS.md` | このリポジトリで作業する AI エージェント向けのリポジトリ固有の指示。 |
| `CONTRIBUTING.md` | 開発セットアップ、コミット規約、 issue ガイドライン。 |
| `SECURITY.md` | サポート対象バージョンと脆弱性の報告方法。 |
| `CHANGELOG.md` | リリース履歴。release-please が管理します。 |

## 開発

```sh
npm install
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # tsup build to dist/
```

## ライセンス

[MIT](LICENSE)

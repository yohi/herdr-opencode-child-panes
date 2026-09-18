# getting-started

[English version](../docs/getting-started.md)

> [!NOTE]
> この文書は [English version](../docs/getting-started.md) の日本語訳です。
> 内容に相違がある場合は、英語版を権威あるものとします。

このガイドでは、`herdr-opencode-child-panes` のインストールと動作確認までの手順を説明します。

## 前提条件

- **Node.js** 20 以降。
- **Herdr** がインストールされ、`PATH` 上で `herdr` として利用できること。
- このプラグインが消費するプラグインフックを備えた **OpenCode** 1.17.x 以降。
- OpenCode ルートセッションをホストするよう設定された Herdr ペイン。

## Herdr 統合のインストール

Herdr がペイン内で OpenCode を実行できるように、統合を登録します:

```sh
herdr integration install opencode
```

登録されているか確認します:

```sh
herdr integration list
```

## プラグインのビルドとインストール

プラグインリポジトリをクローンまたは開き、ビルドします:

```sh
npm install
npm run build
```

ビルドされた `dist/` ディレクトリを OpenCode のプラグインディレクトリへコピーします。正確なパスは OpenCode のインストール方法に依存します:

```sh
cp -r dist <opencode-plugins-dir>/herdr-opencode-child-panes
```

多くの環境では、プラグインディレクトリは OpenCode の設定ディレクトリ配下にあります。不明な場合は OpenCode のプラグインドキュメントを参照してください。

OpenCode を再起動してプラグインを読み込みます。

## 最初の子ペインを確認する

1. OpenCode ルートセッションをホストする Herdr ペインを開きます。
2. エージェントにサブエージェントを起動するよう依頼します。例:

   ```text
   Use a subagent to summarize README.md.
   ```

3. ルートセッションの右側に新しいペインが表示され、`opencode attach <child-session-id>` を実行することを確認します。
4. メインペインはフォーカスを維持します。サブエージェントが完了してアイドルになると、設定された猶予期間後に子ペインは自動的に閉じられます。

## よくある落とし穴

- **子ペインが表示されない**: ペイン内で `HERDR_ENV` と `HERDR_PANE_ID` が設定されていることを確認してください。これらはユーザーではなく Herdr によって設定されます。
- **子ペインは開くがアタッチに失敗する**: 新しいペイン内で `opencode` が `PATH` 上にあり、OpenCode サーバーに到達できることを確認してください。
- **ペインが多く重なる**: `HERDR_CHILD_PANES_MAX` を確認してください。デフォルトは `4` で、それ以上の子セッションは可視化対象から無視されます。
- **アイドルなペインが開いたままになる**: `HERDR_CHILD_PANES_IDLE_MS` を確認してください。デフォルトの猶予期間は 10 秒ですが、新しいアクティビティでクローズタイマーがキャンセルされます。
- **外部操作後にレイアウトがおかしくなる**: プラグインはライブレイアウトから容量を数えますが、カスタムレイアウトを復元しません。OpenCode を再起動すると、新しい子セッションのレイアウトが再構築されます。

正確な状態機械の動作については [SPEC.md](../SPEC.md) を参照してください。

# Ticket Timer / GitHub Pages

2026/10/26: パスワード付きの暗号化HTMLに戻しました。

## ビルドと公開

```sh
npm run build
npm run verify-public
```

パスワードを2回入力します（入力は非表示）。パスワードはファイルに保存しません。ビルドは暗号化した `dist/index.html` と `.nojekyll` を生成し、リポジトリのルートにも配置します。ルートの2ファイルをコミット・pushするとGitHub Pagesに反映されます。公開検証は平文HTMLを拒否します。

公開URL: https://ryushin-dev.github.io/ticket-timer/

`npm run preview` は開発用の平文表示、`npm run serve` はパスワード付き公開版の確認です。再読み込み時は再度パスワードを入力します。

以下は従来の仕様・公開履歴です。


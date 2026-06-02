# WavEdit

ブラウザだけで WAV ファイルの必要な範囲を切り出せる、シンプルな音声エディターです。音声ファイルはサーバーへ送信されません。

## ローカルで起動する

```sh
npm install
npm run dev
```

## GitHub Pages で公開する

このリポジトリには、`main` ブランチへ push すると Vite の静的ファイルをビルドして GitHub Pages へデプロイする GitHub Actions ワークフローが含まれています。

1. GitHub 上でリポジトリの **Settings** → **Pages** を開きます。
2. **Build and deployment** の **Source** に **GitHub Actions** を選択します。
3. `main` ブランチへ push するか、**Actions** → **Deploy to GitHub Pages** → **Run workflow** で手動実行します。

公開先がプロジェクトサイト（`https://<user>.github.io/<repository>/`）でもユーザーサイト（`https://<user>.github.io/`）でもアセットを読み込めるように、Vite は相対パスで出力する設定です。

## コマンド

```sh
npm run dev      # 開発サーバー
npm run build    # 本番用の静的ファイルを dist/ に出力
npm run lint     # ESLint
npm run preview  # dist/ をローカルでプレビュー
```

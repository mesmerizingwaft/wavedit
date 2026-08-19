# WavEdit

WavEdit は、ダウンロードもインストールも不要で気軽に使えるブラウザ DAW です。複数の WAV トラックを読み込み、ブラウザ上ですぐに同期再生・波形編集・エフェクト調整ができます。音声ファイルは端末内で処理され、サーバーへ送信されません。

## 主な機能

- 複数の WAV トラックの同期再生とループ再生
- 波形の拡大・縮小と、トラックごとの編集範囲選択
- コピー、貼り付け、選択区間を無音にする切り取り
- トラックごとの音量調整とミュート
- 全体の音量、ローパスフィルター、リバーブのリアルタイム調整
- 再生範囲を指定し、選択中のトラックを WAV として書き出し

ファイルをまとめてドロップするだけで制作を始められます。全トラック共通の再生範囲は秒数で、コピー・切り取り用の範囲は波形上のドラッグでトラックごとに指定できます。

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

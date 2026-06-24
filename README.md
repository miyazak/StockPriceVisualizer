# Stock Price Visualizer Prototype

Windows上で動作する、持ち株管理プロトタイプです。

対象資産:
- 日本国内株式
- 米国株式
- 米国ETF

機能:
- 証券コードまたは企業名で銘柄検索
- 購入価格と保有数を手入力して登録
- 保有一覧の評価額と損益表示
- ポートフォリオ円グラフ表示
- 公開APIによる価格更新

## 使用API
- Alpha Vantage (SYMBOL_SEARCH, GLOBAL_QUOTE)
- ExchangeRate-API (USD/JPY)

注記:
- Alpha Vantageは無料枠のレート制限があります。
- APIキー未設定時は `demo` キーを使用します。

## セットアップ
1. Node.js LTS をインストール
2. 依存をインストール

```powershell
npm.cmd install
```

3. 開発サーバーを起動

```powershell
npm.cmd run dev
```

4. ブラウザで表示されたURLを開く

## 開発サーバーの停止
開発サーバーを起動したターミナルで次を実行します。

1. `Ctrl + C` を押す
2. 停止確認が表示された場合は `Y` を入力して Enter

VS Codeのタスクから起動している場合は、コマンドパレットで
`Tasks: Terminate Task` を実行し、`Run Vite Dev Server` を停止してください。

## ビルド

```powershell
npm.cmd run build
```

## 環境変数
必要に応じてプロジェクトルートに `.env` を作成します。

```env
VITE_ALPHA_VANTAGE_API_KEY=your_api_key
```

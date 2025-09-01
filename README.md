# 運転診断レポート生成システム

## 概要

ドライバーの運転診断データを元に、HTMLおよびPDF形式のレポートを生成するWebアプリケーションです。

## 主な機能

-   **レポート一覧ダッシュボード**: 全てのレポートへアクセスできるWeb UI
-   **HTMLプレビュー**: 全員分・個人別のレポートをブラウザで確認
-   **PDFダウンロード**: 全員分・個人別のレポートをPDF形式でダウンロード
-   **フォント埋め込み**: Noto Sans JPフォントをPDFに埋め込み、環境を問わず同じ表示を保証

## 動作要件

-   Node.js
-   npm (Node.jsに付属)

## 1. インストール

プロジェクトのルートディレクトリで、以下のコマンドを実行して必要なライブラリをインストールします。

```bash
npm install
```

## 2. 環境変数の設定

このアプリケーションは、PDFを生成する際に自身のURLを知る必要があります。設定は `.env` ファイルで行います。

まず、プロジェクトのルートにある `.env.example` ファイルをコピーして `.env` ファイルを作成します。

```bash
cp .env.example .env
```

次に、`.env` ファイルを環境に合わせて編集します。

```
# .envファイルの内容

# アプリケーションが動作するドメイン名
APP_DOMAIN=localhost

# アプリケーションが使用するポート番号
APP_PORT=3000
```

**重要**: ここの `APP_DOMAIN` と `APP_PORT` の値は、**サーバーの公開設定により適宜変更してください。** 例えば、本番環境のドメインが `https://reports.example.com` であれば、`APP_DOMAIN` は `reports.example.com` に、`APP_PORT`は `443` または `80` （もしくはプロキシ設定に応じた値）になります。

## 3. アプリケーションの実行

以下のコマンドでWebサーバーを起動します。

```bash
node server.js
```

サーバーが起動したら、Webブラウザで `http://localhost:3000` にアクセスしてください。


## 4. Puppeteer PDF 生成環境のセットアップ (Amazon Linux)

このプロジェクトでは Puppeteer を使用して PDF を生成しています。  
Amazon Linux (EC2) 環境では Chromium が必要とするライブラリを事前にインストールしてください。  

## セットアップ手順 (Amazon Linux 2 / Amazon Linux 2023)

### 1. システムライブラリのインストール
```bash
sudo yum update -y
sudo yum install -y \
  chromium \
  nss \
  atk \
  gtk3 \
  xorg-x11-server-Xvfb \
  xorg-x11-xauth \
  xorg-x11-utils \
  ipa-gothic-fonts ipa-mincho-fonts
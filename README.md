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

## 2. Puppeteer PDF 生成環境のセットアップ (Amazon Linux)

このプロジェクトでは Puppeteer を使用して PDF を生成しています。  
Amazon Linux (EC2) 環境では Chromium が必要とするライブラリを事前にインストールしてください。  

## セットアップ手順 (Amazon Linux 2 / Amazon Linux 2023)

## 3. システムライブラリのインストール
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
```

## 4. 環境変数の設定

### 環境変数設定（Local, Railway, EC2 共通）

アプリ内で公開URLを参照するために、以下の環境変数を設定してください。

| Key    | Value                                    |
|--------|-------------------------------------------|
| DOMAIN | your-domain.xxx                   |

- **Railway**: ダッシュボード > 対象サービス > **Variables** タブで追加
- **EC2 等のサーバー**: `/etc/profile.d/env.sh` に `export DOMAIN=your-domain.xxx` を記載し、再起動または `source` で反映
- **Local 環境**: ハードコーディングで127.0.01:3000を設定


## 5. アプリケーションの実行

以下のコマンドでWebサーバーを起動します。

```bash
node server.js
```

# 糖尿病改善サポート（Auth0ログイン修正版）

## 今回の修正
- Auth0公式CDN（cdn.auth0.com）のSPA SDKを使用するように変更しました。
- SDKの初期化後にログイン・新規登録ボタンを有効にします。
- Auth0のメールアドレス・パスワード入力はAuth0のホスト型ログイン画面で行います。

## Auth0設定
- Domain: dev-sjxnzbhtja8bcx2v.us.auth0.com
- Client ID: a4uAboQssJaeVLBuf9eOiXNlOznkAD2t
- Allowed Callback URLs / Allowed Logout URLs: https://blue4116.github.io/tousitu_File/
- Allowed Web Origins: https://blue4116.github.io

Client SecretはHTMLやJavaScriptに絶対に記載しないでください。

## 注意
この版はログイン接続の確認用です。食事・血糖値・体組成のクラウド保存はまだ接続していません。

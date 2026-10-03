# ことば辞典 v0.5

アカウントごとに自分の辞典データを管理するバージョンです。

## 主な変更

- メールアドレス＋パスワードの新規登録
- ログイン
- ログアウト
- パスワード再設定メール
- アカウントごとのクラウド保存
- ユーザーごとのデータ分離
- RLSによるアクセス制御
- 旧localStorageデータのアカウント移行
- アカウント単位のバックアップ・復元

## 使用技術

- HTML
- CSS
- JavaScript
- Supabase Auth
- Supabase Postgres
- Row Level Security

## セキュリティ

ブラウザにはSupabaseのPublishable keyだけを置きます。

Secret key / service_role keyはブラウザへ公開しません。

データベースでは `user_id` と `auth.uid()` をRLSで照合します。

## セットアップ

詳しくは `SETUP.md` を確認してください。

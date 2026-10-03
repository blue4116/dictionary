# ことば辞典 v0.5 アカウント対応

このバージョンから、辞典データをブラウザのlocalStorageだけで管理せず、Supabaseのアカウントに紐づけて保存します。

## 重要

複数人で同じWebアプリを使っても、`user_id` と Row Level Security (RLS) によって、ログインしたユーザー自身のデータだけを取得・追加・変更・削除する設計です。

Supabase公式でも、AuthとRLSを組み合わせて `auth.uid()` とユーザーIDを照合する方法が案内されています。

## 1. Supabaseプロジェクトを作る

Supabaseで新しいプロジェクトを作成します。

## 2. データベースを作る

SupabaseのSQL Editorを開き、

`supabase_schema.sql`

の内容をすべて貼り付けて実行します。

このSQLでは、

- dictionary_entriesテーブル
- user_id
- SELECTポリシー
- INSERTポリシー
- UPDATEポリシー
- DELETEポリシー
- user_idインデックス

を作成します。

## 3. Authを設定する

SupabaseのAuthenticationでメール・パスワード認証を使用します。

メール確認を有効にする場合、登録後に確認メールが必要です。

## 4. Project URLとPublishable keyを設定

`config.js`を開いて、

```text
const SUPABASE_URL = "ここにSupabaseのProject URL";
const SUPABASE_PUBLISHABLE_KEY = "ここにSupabaseのPublishable key";
```

を自分のプロジェクトの値へ変更します。

ブラウザ側に置くのはPublishable keyです。

**service_role / secret keyは絶対にconfig.jsへ入れないでください。**

## 5. GitHub Pagesへアップロード

以下をGitHubリポジトリへアップロードします。

- index.html
- style.css
- script.js
- config.js
- supabase_schema.sql
- README.md

## 6. URL設定（メール確認エラー対策）

SupabaseのAuthentication → URL Configurationで設定します。

### Site URL

GitHub Pagesで公開したURLを設定します。

例：

```text
https://ユーザー名.github.io/kotoba-jiten/
```

### Redirect URLs

同じURLをRedirect URLにも追加してください。

このアプリは新規登録時に、現在開いているページを `redirectTo` として指定します。そのため、GitHub Pagesのサブフォルダで公開しても、確認メールのクリック後に正しいアプリへ戻れるようになっています。Supabaseでは、`redirectTo` に指定するURLをRedirect URLsの許可リストへ登録する必要があります。

確認メールをクリックしたときに `otp_expired` などが返った場合も、アプリ側でエラーを読み取り、分かりやすい日本語メッセージを表示します。

## 7. 旧バージョンからの移行

v0.4以前にこの端末のブラウザへ保存していたデータがある場合、

ログイン後に「この端末に以前の辞典データがあります」と表示されます。

「アカウントへ移行」を押すと、そのデータを現在ログインしているアカウントへコピーします。

## データ分離の仕組み

例えば、

Aさん → user_id = A

Bさん → user_id = B

となり、データベースにはそれぞれのuser_idを付けて保存します。

RLSでは、

`auth.uid() = user_id`

を条件にしているため、AさんがBさんのデータを取得・変更・削除できない構成です。

## 注意

このv0.5はSupabaseの設定が必要です。

設定前はログイン画面が表示されますが、データベースへの接続はできません。

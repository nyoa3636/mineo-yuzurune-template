# mineo「ゆずるね。」自動宣言

GitHub Actionsで、平日16:10（日本時間）にmineoマイページへアクセスし、翌営業日の「ゆずるね。」を宣言します。金曜日の実行は月曜日分です。

初回設定・クラウド実行ともにGoogle Chrome Stableを使用します。GitHub Actionsでは仮想画面上の通常表示Chromeとして起動します。

## テンプレートから始める

1. GitHubの **Use this template → Create a new repository** を選びます。
2. 作成するリポジトリの公開範囲は **Private** を推奨します。
3. 作成したリポジトリを手元へcloneし、以下の初回設定を行います。

公開テンプレートには認証情報やセッションは含まれていません。利用者ごとに自分のリポジトリへ `MINEO_STORAGE_STATE` を登録してください。

## 重要な注意

- 配布元テンプレートは公開できますが、実際にSecretを登録して運用するリポジトリは**非公開**を推奨します。GitHub Freeの非公開リポジトリは月2,000分までActionsを無料で利用できます。
- mineoの二段階認証はメールまたはSMSのワンタイムキーです。認証アプリ用のTOTPシークレットは使用しません。
- 初回ログインで選ぶ「この端末を信頼する」の情報をセッションとしてGitHub Secretsに保管します。セッションが失効・無効化された場合は再設定が必要です。
- 通常のログインセッションが切れた場合は、GitHub SecretsのeoID・パスワードで自動再ログインします。信頼済み端末が有効ならワンタイムキーは省略されます。
- ログイン成功時の新しいセッションは、実行のたびにSecretへ保存し直せます。`SESSION_UPDATE_TOKEN`（ActionsのSecrets更新権限を持つfine-grained PAT、Contents: read / Secrets: write）を登録すると自動で更新されます。未設定でも宣言は動きますが、セッションは初回登録のまま固定されます。
- セッションはログイン済み状態を再現できる機密情報です。GitHub Secret以外へ保存・共有しないでください。
- CAPTCHAや追加認証を回避する処理は実装していません。発生時はワークフローを失敗させます。

## 初回設定

1. Google ChromeとNode.js 22以降をインストールし、次を実行します。

   ```bash
   npm install
   npm run bootstrap-session
   ```

2. 専用の一時Chromeプロファイルが開きます。mineoへログインし、ワンタイムキーを入力して、必ず「この端末を信頼する」を選択します。マイページが表示されると、スクリプトが自動でセッションを保存します。通常利用中のChromeプロファイル、保存パスワード、Cookieは読み取りません。
3. セッションをBase64化します。

   ```bash
   npm run encode-session
   ```

4. GitHubの **Settings → Secrets and variables → Actions → New repository secret** に、以下の3件を登録します。値はチャット・Issue・コミットに貼り付けないでください。

   - `MINEO_STORAGE_STATE`: `npm run encode-session` の出力
   - `MINEO_EOID`: 自分のeoID
   - `MINEO_PASSWORD`: eoIDパスワード
5. 必要に応じて **Settings → Actions → General** でActionsを有効にします。
6. Actionsタブから **Declare mineo Yuzurune** を手動実行し、成功を確認します。
7. 成功確認後、ローカルの `.mineo-storage-state.json` を削除します。GitHub Secretはそのまま利用できます。

## 復旧

`SESSION_EXPIRED`、`BOT_CHALLENGE`、`DECLARATION_CONTROL_NOT_FOUND` が出た場合、Actionsのログに個人情報は出ません。

- `SESSION_EXPIRED`: 初回設定をやり直し、`MINEO_STORAGE_STATE`を置き換えます。
- `LOGIN_FAILED`: `MINEO_EOID`と`MINEO_PASSWORD`を確認します。
- `OTP_REQUIRED`: 信頼済み端末の登録が失効しています。初回設定をやり直します。
- `BOT_CHALLENGE`: mineo側の確認を手動で完了してから、初回設定をやり直します。
- `DECLARATION_CONTROL_NOT_FOUND`: mineo画面が変わった可能性があります。`src/declare.ts` の `declarationControl` を実際の画面に合わせて更新します。

## 開発時の確認

```bash
npm test
```

実際のmineoアカウントを使う動作確認は、GitHub Actionsの手動実行でのみ行ってください。画面キャプチャ・HTML・認証情報を成果物やログとして保存しないでください。

## License

[MIT License](LICENSE)

# 旅ログ

Aileronとは独立した、旅行計画・旅の記録・共有リンクのテスト版です。

## 公開URL

- Webアプリ: https://tabi-log.pages.dev/
- Worker health: https://tabi-log.haruto-9519.workers.dev/api/health

## 現在使える機能

- モバイル対応UI
- 旅程の作成・削除・コピー、立ち寄り先追加
- 訪問済み場所の記録
- 写真（JPEG・PNG・WebP、1枚5MBまで）の端末内保存とGoogle Drive同期機能
- 投稿と旅程の紐づけ、日記タイムライン
- フィード検索・カテゴリ絞り込み・並び替え
- いいね・コメント・保存・フォロー等のブラウザ内デモ操作
- 旅程の共有URL発行・再コピー・共有停止
- 共有URLは発行後365日で期限切れ
- 共有APIは1IPハッシュあたり10分間に8回までの作成制限
- 共有APIは20KBの本文上限と、期限切れ・無効化済み記録の整理を実装

## データの保存先と重要な制限

- 旅程、投稿、プロフィール、いいね等のデモ状態はブラウザのlocalStorageに保存されます。
- 写真はIndexedDBに一時保存し、Google Drive連携後に利用者本人のDrive内「Tabi Log / 旅行名」フォルダへ非公開でアップロードします。
- D1にはGoogle DriveのファイルIDと写真形式のみを保存します。写真本体はCloudflare R2には保存しません。
- 別端末では同じGoogleアカウントで旅ログにログインし、「Google Driveを連携」すると写真を読み込めます。
- 動画は初期仕様の対象外です。以前に端末へ保存した動画は端末内に残りますが、Drive同期されません。
- 共有URLを発行した場合に限り、共有操作で選択したテキスト情報がCloudflare D1に保存されます。
- 共有URLを知っている人は内容を閲覧できます。URLは公開範囲を限定したい相手にだけ渡してください。
- 共有解除に使うキーは発行時のブラウザ内に保存されます。ブラウザデータを消すと、再発行済みURLをその端末から解除できなくなる場合があります。
- フィードの初期投稿はサンプルです。現状、他ユーザー共通の公開フィードではありません。
- 公開範囲、フォロー、いいね、コメント、通報などの一部UIはブラウザ内デモであり、ユーザー間の実通信・運営への通報送信は未接続です。
- ルート表示はサンプル画像であり、実地図・GPS・経路検索とは未接続です。
- Google Identity Servicesのログイン画面とWorker側のIDトークン署名・audience・issuer・有効期限検証を実装済み。実環境へのデプロイとログイン動作確認は未完了です。
- Googleログイン、期限付きセッション、旅程・投稿のD1同期を実装しています。Google Driveの写真保存はブラウザ側OAuth許可とGoogle Drive API有効化後に利用できます。

## Cloudflare構成

- Pages: `tabi-log.pages.dev`
- Worker: `tabi-log.haruto-9519.workers.dev`
- D1: `tabi-log-db`
- D1 binding: `DB`
- D1 migrations: `worker/migrations/0001_init.sql`, `worker/migrations/0002_share_links.sql`, `worker/migrations/0003_auth_sessions.sql`
- Worker設定: `worker/wrangler.toml`

## 本格公開前に必要な作業

1. GoogleログインをCloudflare本番環境へ反映し、テストユーザーで認証・ログアウトを確認
2. 公開投稿・フォロー・いいね・コメントをサーバー側に接続
3. Google Cloud側でGoogle Drive APIを有効化し、OAuth同意画面に `https://www.googleapis.com/auth/drive.file` を追加。テストユーザーでGoogle Drive連携・写真保存・別端末復元を確認
4. 通報の運営受信、削除依頼窓口、ブロック・モデレーションを実装
5. 利用規約、プライバシーポリシー、問い合わせ先を整備
6. 実機で共有作成・閲覧・解除、期限切れ、異常入力、モバイル表示を確認

このリポジトリは個人向け旅行記録機能を仕上げている段階です。Google Drive API/OAuthのGoogle Cloud側設定と、実際のGoogleアカウントを使った写真保存・復元テストは別途必要です。

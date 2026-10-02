# GameVault — Deploy Ready

## Render (recommended for this current SQLite MVP)
1. Upload this project to a GitHub repository.
2. In Render, create a Blueprint and select the repository.
3. Render reads `render.yaml` and creates the web service + persistent disk.
4. Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in the Render dashboard.
5. Deploy. The generated `onrender.com` URL becomes the public GameVault URL.

## Important
This is an MVP. Before real-money commercial launch, add a compliant payment/escrow provider, KYC/identity flow if required, chargeback/refund handling, image/object storage, email verification, stronger moderation, backups/monitoring, legal terms/privacy/cookie pages, and publisher-specific account-transfer compliance.
Do not put secrets in the repository.

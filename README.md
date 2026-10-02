# GameVault — Production-ready MVP package

## Included
- Responsive marketplace UI
- Register/login with JWT
- Password hashing
- Listings with game/category/price/status
- Search, filters and sorting
- Seller dashboard
- Offers
- Favorites
- Buyer/seller messaging
- Reviews and seller trust score
- Admin dashboard and moderation
- Audit log
- Rate limiting, Helmet, compression, CORS
- SQLite persistence
- Docker + environment template

## Run locally
1. Install Node.js 20+
2. `npm install`
3. Copy `.env.example` to `.env`
4. Change `JWT_SECRET` and admin password
5. `npm start`
6. Open `http://localhost:3000`

## Important
This is a marketplace MVP, not a licensed payment/escrow service. Real-money payments, KYC/identity verification, chargeback handling, tax/legal terms, game-publisher transfer rules, and production monitoring must be connected and reviewed before live commercial use.

# ITop Med

Multi-tenant healthcare management platform. Start with [CLAUDE.md](CLAUDE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

```bash
npm install
cp .env.example .env   # then generate APP_ENCRYPTION_KEY and AUDIT_HMAC_KEY
npm run db:start       # separate terminal; embedded PostgreSQL, no Docker needed
npm run db:migrate && npm run db:seed
npm run admin:create -- --email you@example.uz --name "Your Name" --role SUPER_ADMIN
npm run dev            # http://localhost:3000/admin/login
```

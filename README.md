# ITop Med

Multi-tenant healthcare management platform — one product for a one-doctor office, a dental clinic, a diagnostic centre or a multi-branch hospital.

* **O'zbekcha to'liq qo'llanma (o'rnatish, ishga tushirish, boshqarish):** [docs/QOLLANMA.md](docs/QOLLANMA.md)
* Engineering guide: [CLAUDE.md](CLAUDE.md) · status: [docs/ROADMAP.md](docs/ROADMAP.md) · production: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## First run on a new computer
```bash
npm install
npm run setup          # creates .env with random passwords and keys (never overwrites)
npm run db:start       # separate terminal, first time only; embedded PostgreSQL, no Docker
npm run db:migrate && npm run db:seed
npm run admin:create -- --email you@example.uz --name "Your Name" --role SUPER_ADMIN
```

## Run for the whole clinic network (phones, tablets, PCs; installable app)
```bash
npm run local          # database + production build + worker + HTTPS on :3443
```
Each device trusts `.data/certs/itopmed-local-ca.crt` once — see docs/QOLLANMA.md §4.

## Development
```bash
npm run db:start
npm run dev            # http://localhost:3000/admin/login
```

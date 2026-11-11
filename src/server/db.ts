import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { env } from "./env";

/**
 * Two physically separate connection pools, one per PostgreSQL role:
 *
 *  - appDb       → itopmed_app       clinic workspaces, Row-Level Security enforced.
 *                   Must ONLY be used through `withAppContext`, which binds the
 *                   tenant/user for the duration of one transaction.
 *  - platformDb  → itopmed_platform  ITop Med administration. The role has no
 *                   grants on clinical tables, so platform code cannot read
 *                   medical records even if it tried.
 */
type Clients = { app?: PrismaClient; platform?: PrismaClient };
const g = globalThis as unknown as { __itmDb?: Clients };
const clients: Clients = (g.__itmDb ??= {});

function make(url: string) {
  // Pool size per app instance; tune with DB_POOL_MAX to the database max_connections budget.
  const max = Number(process.env.DB_POOL_MAX ?? 10);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: Number.isFinite(max) && max > 0 ? max : 10, idleTimeoutMillis: 30_000 }) });
}

function appClient(): PrismaClient {
  return (clients.app ??= make(env().DATABASE_URL));
}

export function platformDb(): PrismaClient {
  return (clients.platform ??= make(env().PLATFORM_DATABASE_URL));
}

export type Tx = Prisma.TransactionClient;

export interface AppContext {
  tenantId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  inviteTokenHash?: string | null;
  resetTokenHash?: string | null;
}

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * Runs `fn` in a transaction whose PostgreSQL session variables carry the
 * request context. RLS policies read these via app_current_tenant() etc.
 * `set_config(..., true)` scopes values to this transaction only, so pooled
 * connections can never leak context between requests.
 */
export async function withAppContext<T>(ctx: AppContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appClient().$transaction(async (tx) => {
    await setContext(tx, ctx);
    return fn(tx);
  }, TX_OPTIONS);
}

export async function setContext(tx: Tx, ctx: AppContext) {
  await tx.$queryRaw`SELECT
    set_config('app.tenant_id', ${ctx.tenantId ?? ""}, true),
    set_config('app.user_id', ${ctx.userId ?? ""}, true),
    set_config('app.session_id', ${ctx.sessionId ?? ""}, true),
    set_config('app.invite_token_hash', ${ctx.inviteTokenHash ?? ""}, true),
    set_config('app.reset_token_hash', ${ctx.resetTokenHash ?? ""}, true)`;
}

export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return platformDb().$transaction(fn, TX_OPTIONS);
}

/** For tests and graceful shutdown. */
export async function disconnectAll() {
  await Promise.all([clients.app?.$disconnect(), clients.platform?.$disconnect()]);
  clients.app = undefined;
  clients.platform = undefined;
}

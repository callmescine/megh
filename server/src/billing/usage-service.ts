import { query } from '../db/connection.js';
import { getRedis } from '../db/redis.js';

export interface UsageEvent {
  id: string;
  user_id: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: Date;
}

export interface BalanceInfo {
  balance_usd: number;
  billing_tier: string;
  monthly_limit_usd: number;
  current_month_usage: number;
}

export interface UsageHistoryResult {
  events: UsageEvent[];
  total: number;
  page: number;
  limit: number;
}

export interface SessionUsageModel {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface SessionUsageResult {
  models: SessionUsageModel[];
  total: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
}

export async function getBalance(userId: string): Promise<BalanceInfo> {
  const redis = getRedis();

  // Try dedicated balance-info cache (separate from the proxy's plain-number key)
  const cached = await redis.get(`user:${userId}:balance_info`);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object' && 'balance_usd' in parsed) {
        return parsed;
      }
    } catch {
      // Corrupt cache — fall through to DB query
    }
  }

  // Query from DB
  const result = await query(
    'SELECT balance_usd, billing_tier, monthly_limit_usd FROM billing_accounts WHERE user_id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return {
      balance_usd: 0,
      billing_tier: 'free',
      monthly_limit_usd: 0,
      current_month_usage: 0,
    };
  }

  const row = result.rows[0];
  const rawBalance = parseFloat(row.balance_usd);
  const currentMonthUsage = await getMonthlyTotal(userId);

  const balanceInfo: BalanceInfo = {
    balance_usd: isNaN(rawBalance) ? 0 : rawBalance,
    billing_tier: row.billing_tier,
    monthly_limit_usd: parseFloat(row.monthly_limit_usd) || 0,
    current_month_usage: currentMonthUsage,
  };

  // Cache in a SEPARATE key from the proxy's user:{id}:balance (plain number)
  // The proxy uses incrbyfloat on user:{id}:balance — storing JSON there breaks it.
  await redis.set(
    `user:${userId}:balance_info`,
    JSON.stringify(balanceInfo),
    'EX',
    300
  );

  return balanceInfo;
}

export async function getUsageHistory(
  userId: string,
  opts: {
    page?: number;
    limit?: number;
    from?: Date;
    to?: Date;
    sessionId?: string;
  } = {}
): Promise<UsageHistoryResult> {
  const page = opts.page || 1;
  const limit = opts.limit || 50;
  const offset = (page - 1) * limit;

  const conditions: string[] = ['user_id = $1'];
  const params: (string | number | Date)[] = [userId];
  let paramIndex = 2;

  if (opts.from) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(opts.from);
    paramIndex++;
  }

  if (opts.to) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(opts.to);
    paramIndex++;
  }

  if (opts.sessionId) {
    conditions.push(`session_id = $${paramIndex}`);
    params.push(opts.sessionId);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) as total FROM usage_events WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Get paginated events
  const eventsResult = await query(
    `SELECT * FROM usage_events WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return {
    events: eventsResult.rows,
    total,
    page,
    limit,
  };
}

export async function getSessionUsage(sessionId: string): Promise<SessionUsageResult> {
  // Per-model breakdown
  const modelsResult = await query(
    `SELECT model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(cost_usd) as cost_usd
     FROM usage_events
     WHERE session_id = $1
     GROUP BY model`,
    [sessionId]
  );

  const models: SessionUsageModel[] = modelsResult.rows.map((row: any) => ({
    model: row.model,
    input_tokens: parseInt(row.input_tokens, 10),
    output_tokens: parseInt(row.output_tokens, 10),
    cost_usd: parseFloat(row.cost_usd),
  }));

  // Total across all models
  const totalResult = await query(
    `SELECT SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(cost_usd) as cost_usd
     FROM usage_events
     WHERE session_id = $1`,
    [sessionId]
  );

  const totalRow = totalResult.rows[0];

  return {
    models,
    total: {
      input_tokens: parseInt(totalRow.input_tokens || '0', 10),
      output_tokens: parseInt(totalRow.output_tokens || '0', 10),
      cost_usd: parseFloat(totalRow.cost_usd || '0'),
    },
  };
}

export async function getMonthlyTotal(userId: string): Promise<number> {
  const result = await query(
    `SELECT SUM(cost_usd) as total FROM usage_events WHERE user_id = $1 AND created_at >= date_trunc('month', NOW())`,
    [userId]
  );

  return parseFloat(result.rows[0]?.total || '0');
}

// deductBalance was removed (3.6): it only decremented Redis without updating PostgreSQL.
// Balance deductions happen in the usage proxy via incrbyfloat + recordUsageEvent.

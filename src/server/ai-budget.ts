import type {Env} from '../../worker'

// Issue #19 lists actual-cost billing with no guaranteed maximum. Only a reviewed
// provider guarantee for the complete bounded request may replace this value.
export const verifiedMaximumMicros: number | null = null
export function aiReady(env: Env, maximum: number | null = verifiedMaximumMicros) {
  return env.AI_GENERATION_ENABLED === 'true' && !!env.API_WORKER && !!env.APP_OWNER_JWT?.trim() &&
    maximum !== null && Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 100000
}

// Lifetime $0.10 and 100,000 reserved token units per app. No reset or refund
// on ambiguous outcomes. Rolling request ceilings apply in addition.
export async function reserveAI(env: Env, room: string, owner: string, confirmation: string, tokens: number, micros: number) {
  const db = env.INVITATION_QUOTA
  const app = env.DEEPSPACE_APP_ID
  const results = await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_attempts(app TEXT, confirmation TEXT, room TEXT,
      owner TEXT, tokens INTEGER, micros INTEGER, reserved INTEGER, PRIMARY KEY(app,confirmation))`),
    db.prepare(`INSERT INTO ai_attempts SELECT ?,?,?,?,?,?,unixepoch()
      WHERE EXISTS(SELECT 1 FROM integration_settings WHERE app=? AND feature='ai' AND enabled=1)
      AND (SELECT COALESCE(SUM(micros),0) FROM ai_attempts WHERE app=?) + ? <= 100000
      AND (SELECT COALESCE(SUM(tokens),0) FROM ai_attempts WHERE app=?) + ? <= 100000
      AND (SELECT COUNT(*) FROM ai_attempts WHERE app=? AND reserved>unixepoch()-86400) < 10
      AND (SELECT COUNT(*) FROM ai_attempts WHERE app=? AND owner=? AND reserved>unixepoch()-86400) < 5
      AND (SELECT COUNT(*) FROM ai_attempts WHERE app=? AND room=? AND reserved>unixepoch()-86400) < 2
      ON CONFLICT DO NOTHING`).bind(app,confirmation,room,owner,tokens,micros,app,app,micros,app,tokens,app,app,owner,app,room),
  ])
  return results.every(result => result.success) && results[1].meta.changes === 1
}

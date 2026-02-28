-- Clear false "edited" flags on agent messages caused by upsert retry
UPDATE messages SET updated_at = NULL
WHERE sender_type = 'agent' AND updated_at IS NOT NULL
  AND type = 'agent_response';

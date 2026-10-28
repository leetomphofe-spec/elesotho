/** Generates human-readable references such as PSN-2026-001024. */
export async function nextApplicationReference(db, prefix) {
  const { rows } = await db.query("SELECT nextval('application_ref_seq') AS n");
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(rows[0].n).padStart(6, '0')}`;
}

export async function nextAccessReference(db) {
  const { rows } = await db.query("SELECT nextval('access_request_ref_seq') AS n");
  const year = new Date().getFullYear();
  return `AR-${year}-${String(rows[0].n).padStart(5, '0')}`;
}

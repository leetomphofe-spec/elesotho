// Run the automation jobs once (for a Render Cron Job or manual use).
import { runAutomation } from './lib/automation.js';
import { pool } from './db.js';

runAutomation('cron')
  .then((r) => { console.log('[automation]', r); return pool.end(); })
  .catch((err) => { console.error(err); process.exit(1); });

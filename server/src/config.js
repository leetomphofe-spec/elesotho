const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set (PostgreSQL connection string).');
}

const dbUrl = process.env.DATABASE_URL;

export const config = {
  isProd,
  port: Number(process.env.PORT || 4000),
  databaseUrl: dbUrl,
  // Render "External" URLs need SSL; the internal URL does not.
  dbSsl: process.env.PGSSL === 'true' || /\.render\.com/.test(dbUrl),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''),

  citizenIdleMinutes: Number(process.env.CITIZEN_SESSION_MINUTES || 30),
  staffIdleMinutes: Number(process.env.STAFF_SESSION_MINUTES || 15),
  maxFailedLogins: 5,
  lockMinutes: 15,

  seedDemo: process.env.SEED_DEMO !== 'false',
  showResetLink: process.env.SHOW_RESET_LINK === 'true',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@gov.ls.demo',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@2026!',

  automationIntervalMinutes: Number(process.env.AUTOMATION_INTERVAL_MINUTES || 15),
  timezoneOffset: '+02:00', // Africa/Maseru (no daylight saving)

  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'Government Services <no-reply@example.org>',
  },
};

import 'dotenv/config';

function bool(v, def = false) {
  if (v == null || v === '') return def;
  return v === 'true' || v === '1' || v === 'yes';
}

const INSECURE_DEFAULT_JWT_SECRET = 'dev-insecure-secret-change-me';
const isProd = (process.env.NODE_ENV || 'development') === 'production';

// Refuse to boot in production with a missing/default JWT secret — that secret is
// visible in this public source file, so anyone could forge a valid session token.
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET === INSECURE_DEFAULT_JWT_SECRET)) {
  console.error(
    '\n[FATAL] JWT_SECRET is missing or using the insecure default in production.\n' +
      '  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n' +
      '  and set it as the JWT_SECRET environment variable.\n'
  );
  process.exit(1);
}

// Refuse to boot in production without COOKIE_SECURE — browsers reject a
// SameSite=None cookie that isn't also Secure, which would silently break login
// rather than just being "less safe."
if (isProd && !bool(process.env.COOKIE_SECURE, false)) {
  console.error(
    '\n[FATAL] COOKIE_SECURE must be "true" in production (the app is served over HTTPS).\n' +
      '  Set COOKIE_SECURE=true in your environment variables.\n'
  );
  process.exit(1);
}

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwtSecret: process.env.JWT_SECRET || INSECURE_DEFAULT_JWT_SECRET,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '7d',
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,

  llmProvider: (process.env.LLM_PROVIDER || 'openai').toLowerCase(),
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',

  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  mailFrom: process.env.MAIL_FROM || 'ShotLab <no-reply@shotlab.app>',
  appUrl: process.env.APP_URL || 'http://localhost:5173',

  googleClientId: process.env.GOOGLE_CLIENT_ID || '',

  storageDriver: (process.env.STORAGE_DRIVER || 'local').toLowerCase(),
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '25', 10),
  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || '',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    publicBase: process.env.S3_PUBLIC_BASE_URL || '',
  },
};

export const flags = {
  hasLLM: env.llmProvider === 'anthropic' ? !!env.anthropicKey : !!env.openaiKey,
  hasSMTP: !!env.smtpHost,
  hasGoogle: !!env.googleClientId,
};

import 'dotenv/config';

function bool(v, def = false) {
  if (v == null || v === '') return def;
  return v === 'true' || v === '1' || v === 'yes';
}

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
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
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/auth/google/callback',
  oauthSuccessRedirect: process.env.OAUTH_SUCCESS_REDIRECT || 'http://localhost:5173',

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
  hasGoogle: !!(env.googleClientId && env.googleClientSecret),
};

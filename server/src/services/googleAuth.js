import { OAuth2Client } from 'google-auth-library';
import { Prisma } from '@prisma/client';
import { env } from '../env.js';
import { unauthorized, googleLinkConflict } from '../lib/errors.js';
import { prisma } from '../db.js';

const googleClient = new OAuth2Client();
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export async function verifyGoogleCredential(credential) {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId,
    });
    const payload = ticket.getPayload();
    if (
      !payload ||
      !payload.sub ||
      !payload.email ||
      payload.email_verified !== true ||
      !VALID_ISSUERS.has(payload.iss)
    ) {
      throw unauthorized('Google Sign-In failed.');
    }

    return {
      sub: payload.sub,
      email: payload.email.trim().toLowerCase(),
      name: (payload.name || payload.given_name || '').trim(),
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    };
  } catch (error) {
    if (error?.code === 'UNAUTHORIZED') throw error;
    // Never include the credential or Google's detailed verifier response.
    console.warn('[google-auth] ID token verification failed:', error?.name || 'Error');
    throw unauthorized('Google Sign-In failed.');
  }
}

function safeGoogleUpdates(user, identity) {
  return {
    googleId: identity.sub,
    providerId: user.providerId || identity.sub,
    emailVerified: true,
    ...(user.avatarUrl || !identity.picture ? {} : { avatarUrl: identity.picture }),
  };
}

async function linkInTransaction(identity) {
  return prisma.$transaction(
    async (tx) => {
      const googleUser = await tx.user.findUnique({ where: { googleId: identity.sub } });
      if (googleUser) {
        const conflictingLegacy = await tx.user.findFirst({
          where: { providerId: identity.sub, id: { not: googleUser.id } },
        });
        if (conflictingLegacy) {
          throw googleLinkConflict();
        }
        return tx.user.update({
          where: { id: googleUser.id },
          data: safeGoogleUpdates(googleUser, identity),
        });
      }

      // Migrate accounts linked by the previous OAuth implementation. Multiple
      // matches are ambiguous and must never be merged automatically.
      const legacyMatches = await tx.user.findMany({
        where: { providerId: identity.sub },
        take: 2,
      });
      if (legacyMatches.length > 1) {
        throw googleLinkConflict();
      }
      if (legacyMatches.length === 1) {
        const legacyUser = legacyMatches[0];
        if (legacyUser.googleId && legacyUser.googleId !== identity.sub) {
          throw googleLinkConflict();
        }
        return tx.user.update({
          where: { id: legacyUser.id },
          data: safeGoogleUpdates(legacyUser, identity),
        });
      }

      const emailUser = await tx.user.findUnique({ where: { email: identity.email } });
      if (emailUser) {
        if (emailUser.googleId && emailUser.googleId !== identity.sub) {
          throw googleLinkConflict();
        }
        return tx.user.update({
          where: { id: emailUser.id },
          data: safeGoogleUpdates(emailUser, identity),
        });
      }

      return tx.user.create({
        data: {
          email: identity.email,
          name: identity.name || identity.email.split('@')[0],
          passwordHash: null,
          provider: 'google',
          providerId: identity.sub,
          googleId: identity.sub,
          avatarUrl: identity.picture,
          emailVerified: true,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function findOrLinkGoogleUser(identity) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await linkInTransaction(identity);
    } catch (error) {
      // Concurrent first-time logins can race on email/googleId. Retry the
      // serializable transaction once, then report a safe linking conflict.
      if ((error?.code === 'P2002' || error?.code === 'P2034') && attempt === 0) {
        continue;
      }
      if (error?.code === 'P2002' || error?.code === 'P2034') {
        throw googleLinkConflict();
      }
      throw error;
    }
  }
  throw googleLinkConflict();
}

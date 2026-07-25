import cookieParser from 'cookie-parser';

export const getSignedUserId = (cookieHeader: string | undefined, authSecret: string) => {
  if (!cookieHeader) return null;
  const rawCookie = cookieHeader
    .split(';')
    .map(part => part.trim().split('='))
    .find(([name]) => name === 'userId')
    ?.slice(1)
    .join('=');

  if (!rawCookie) return null;

  try {
    const decoded = decodeURIComponent(rawCookie);
    if (!decoded.startsWith('s:')) return null;
    const unsigned = cookieParser.signedCookie(decoded, authSecret);
    return typeof unsigned === 'string' ? unsigned : null;
  } catch {
    return null;
  }
};

const jwt = require('jsonwebtoken');
const { findTenantById, findUserById, sanitizeUser } = require('./authStore');

const jwtSecret = process.env.JWT_SECRET || 'flowiq-dev-secret';
const jwtExpiry = process.env.JWT_EXPIRES_IN || '8h';

function signAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId || null,
      email: user.email,
      name: user.name,
    },
    jwtSecret,
    {
      expiresIn: jwtExpiry,
    },
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const user = findUserById(decoded.sub);

    if (!user || user.active === false) {
      return res.status(401).json({ error: 'Session is no longer valid' });
    }

    const tenant = user.tenantId ? findTenantById(user.tenantId) : null;
    req.auth = sanitizeUser(user, tenant);
    req.authToken = token;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }

    return next();
  };
}

module.exports = {
  requireAuth,
  requireRoles,
  signAuthToken,
};

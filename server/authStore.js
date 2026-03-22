const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dataDirectory = path.join(__dirname, 'data');
const authStorePath = path.join(dataDirectory, 'auth-store.json');
const validRoles = new Set(['super_admin', 'admin', 'user']);

function ensureDataDirectory() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, passwordSalt, passwordHash) {
  const { hash } = hashPassword(password, passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(passwordHash, 'hex'));
}

function sanitizeUser(user, tenant) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId || null,
    tenantName: tenant?.name || null,
    active: user.active !== false,
  };
}

function writeStore(store) {
  ensureDataDirectory();
  fs.writeFileSync(authStorePath, JSON.stringify(store, null, 2), 'utf8');
}

function createSeedStore() {
  const defaultTenant = {
    id: crypto.randomUUID(),
    name: process.env.DEFAULT_TENANT_NAME || 'Default Tenant',
    slug: slugify(process.env.DEFAULT_TENANT_NAME || 'default'),
    createdAt: new Date().toISOString(),
  };
  const { salt, hash } = hashPassword(process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe123!');

  return {
    tenants: [defaultTenant],
    users: [
      {
        id: crypto.randomUUID(),
        tenantId: null,
        email: (process.env.SUPER_ADMIN_EMAIL || 'superadmin@flowiq.local').toLowerCase(),
        name: process.env.SUPER_ADMIN_NAME || 'FlowIQ Super Admin',
        role: 'super_admin',
        passwordSalt: salt,
        passwordHash: hash,
        active: true,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

function loadStore() {
  ensureDataDirectory();

  if (!fs.existsSync(authStorePath)) {
    const seedStore = createSeedStore();
    writeStore(seedStore);
    return seedStore;
  }

  const content = fs.readFileSync(authStorePath, 'utf8');
  const parsed = JSON.parse(content);
  parsed.tenants = Array.isArray(parsed.tenants) ? parsed.tenants : [];
  parsed.users = Array.isArray(parsed.users) ? parsed.users : [];
  return parsed;
}

function findTenantById(tenantId) {
  const store = loadStore();
  return store.tenants.find((tenant) => tenant.id === tenantId) || null;
}

function findUserByEmail(email) {
  const store = loadStore();
  return store.users.find((user) => user.email === String(email || '').toLowerCase()) || null;
}

function findUserById(userId) {
  const store = loadStore();
  return store.users.find((user) => user.id === userId) || null;
}

function authenticateUser(email, password) {
  const user = findUserByEmail(email);
  if (!user || user.active === false) {
    return null;
  }

  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return null;
  }

  const tenant = user.tenantId ? findTenantById(user.tenantId) : null;
  return sanitizeUser(user, tenant);
}

function listTenants() {
  return loadStore().tenants;
}

function createTenant({ name, slug }) {
  const store = loadStore();
  const tenantSlug = slugify(slug || name);

  if (!name || !tenantSlug) {
    throw new Error('Tenant name is required');
  }

  if (store.tenants.some((tenant) => tenant.slug === tenantSlug)) {
    throw new Error('Tenant slug already exists');
  }

  const tenant = {
    id: crypto.randomUUID(),
    name: name.trim(),
    slug: tenantSlug,
    createdAt: new Date().toISOString(),
  };

  store.tenants.push(tenant);
  writeStore(store);
  return tenant;
}

function listUsers({ tenantId } = {}) {
  const store = loadStore();
  return store.users
    .filter((user) => (tenantId ? user.tenantId === tenantId : true))
    .map((user) => sanitizeUser(user, store.tenants.find((tenant) => tenant.id === user.tenantId)));
}

function createUser({ tenantId, email, password, name, role }) {
  const store = loadStore();
  const normalizedRole = String(role || '').toLowerCase();

  if (!validRoles.has(normalizedRole)) {
    throw new Error('Invalid role');
  }

  if (normalizedRole !== 'super_admin' && !tenantId) {
    throw new Error('tenantId is required for admin and user roles');
  }

  if (!email || !password || !name) {
    throw new Error('name, email, and password are required');
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (store.users.some((user) => user.email === normalizedEmail)) {
    throw new Error('Email already exists');
  }

  const { salt, hash } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    tenantId: normalizedRole === 'super_admin' ? null : tenantId,
    email: normalizedEmail,
    name: name.trim(),
    role: normalizedRole,
    passwordSalt: salt,
    passwordHash: hash,
    active: true,
    createdAt: new Date().toISOString(),
  };

  store.users.push(user);
  writeStore(store);

  const tenant = user.tenantId ? store.tenants.find((item) => item.id === user.tenantId) : null;
  return sanitizeUser(user, tenant);
}

function updateUser(userId, updates) {
  const store = loadStore();
  const user = store.users.find((item) => item.id === userId);

  if (!user) {
    throw new Error('User not found');
  }

  if (updates.name) {
    user.name = String(updates.name).trim();
  }

  if (typeof updates.active === 'boolean') {
    user.active = updates.active;
  }

  if (updates.role) {
    const normalizedRole = String(updates.role).toLowerCase();
    if (!validRoles.has(normalizedRole)) {
      throw new Error('Invalid role');
    }
    user.role = normalizedRole;
  }

  if (updates.password) {
    const { salt, hash } = hashPassword(updates.password);
    user.passwordSalt = salt;
    user.passwordHash = hash;
  }

  if (updates.tenantId !== undefined) {
    user.tenantId = updates.tenantId || null;
  }

  writeStore(store);
  const tenant = user.tenantId ? store.tenants.find((item) => item.id === user.tenantId) : null;
  return sanitizeUser(user, tenant);
}

module.exports = {
  authenticateUser,
  createTenant,
  createUser,
  findTenantById,
  findUserByEmail,
  findUserById,
  listTenants,
  listUsers,
  sanitizeUser,
  updateUser,
};

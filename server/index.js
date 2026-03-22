require('dotenv').config({ quiet: true });

const cors = require('cors');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { calculateCampaign, formatKeys, workbookMetadata } = require('./workbookCalculator');
const { authenticateUser, createTenant, createUser, findTenantById, listTenants, listUsers, updateUser } = require('./authStore');
const { requireAuth, requireRoles, signAuthToken } = require('./auth');
const { getOptionsCacheStatus, getQuoteFormOptions, refreshOptionsCache, searchProcessTypes, searchStockDefinitions } = require('./printiqOptions');

const app = express();
const port = Number(process.env.PORT || 4000);
const printIqBaseUrl = process.env.PRINTIQ_BASE_URL || 'https://adsaust.printiq.com';
const logDirectory = path.join(__dirname, '..', 'logs');
const printIqLogPath = path.join(logDirectory, 'printiq-payloads.log');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function decodeEnvValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeLoginToken(token) {
  return encodeURIComponent(token);
}

function appendPrintIqLog(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(printIqLogPath, line, 'utf8');
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractQuoteAmount(result) {
  return (
    result?.QuoteDetails?.Products?.[0]?.Quantities?.[0]?.Price ??
    result?.QuoteDetails?.Products?.[0]?.Quantities?.[0]?.RetailPrice ??
    result?.QuoteDetails?.Products?.[0]?.Quantities?.[0]?.WholesalePrice ??
    null
  );
}

async function getLoginToken() {
  const params = new URLSearchParams({
    UserName: decodeEnvValue(getRequiredEnv('PRINTIQ_USERNAME')),
    Password: decodeEnvValue(getRequiredEnv('PRINTIQ_PASSWORD')),
    ApplicationName: decodeEnvValue(getRequiredEnv('PRINTIQ_APPLICATION_NAME')),
    ApplicationKey: decodeEnvValue(getRequiredEnv('PRINTIQ_APPLICATION_KEY')),
  });
  const tokenUrl = `${printIqBaseUrl}/api/QuoteProcess/GetApplicationLogInToken`;
  const attempts = [
    {
      name: 'POST querystring',
      execute: () =>
        fetch(`${tokenUrl}?${params.toString()}`, {
          method: 'POST',
        }),
    },
    {
      name: 'POST form body',
      execute: () =>
        fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }),
    },
    {
      name: 'GET querystring',
      execute: () => fetch(`${tokenUrl}?${params.toString()}`),
    },
  ];

  const failures = [];

  for (const attempt of attempts) {
    const response = await attempt.execute();
    const bodyText = await response.text();

    if (response.ok) {
      return bodyText.replace(/^"|"$/g, '').trim();
    }

    failures.push(`${attempt.name} -> (${response.status}) ${bodyText}`);

    if (![400, 404, 405].includes(response.status)) {
      break;
    }
  }

  throw new Error(`Token request failed. Attempts: ${failures.join(' | ')}`);
}

function canManageTargetTenant(authUser, targetTenantId) {
  if (authUser.role === 'super_admin') {
    return true;
  }

  return !!authUser.tenantId && authUser.tenantId === targetTenantId;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    printIqBaseUrl,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = authenticateUser(email, password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signAuthToken(user);
  return res.json({ token, user });
});

app.use('/api', requireAuth);

app.get('/api/auth/me', (req, res) => {
  res.json(req.auth);
});

app.get('/api/calculator/metadata', (_req, res) => {
  res.json({
    markets: workbookMetadata,
    formatKeys,
  });
});

app.post('/api/calculator/calculate', (req, res) => {
  try {
    const summary = calculateCampaign(req.body?.campaignLines);
    res.json(summary);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown calculator error',
    });
  }
});

app.get('/api/printiq/options/quote-form', async (_req, res) => {
  res.json(getQuoteFormOptions());
});

app.get('/api/printiq/options/stocks', async (req, res) => {
  try {
    const stocks = await searchStockDefinitions(String(req.query.q || ''));
    res.json(stocks);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load PrintIQ stock options',
    });
  }
});

app.get('/api/printiq/options/processes', async (req, res) => {
  try {
    const processes = await searchProcessTypes(String(req.query.q || ''));
    res.json(processes);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load PrintIQ process options',
    });
  }
});

app.get('/api/printiq/token', async (_req, res) => {
  try {
    const token = await getLoginToken();
    res.json({ token });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown token error',
    });
  }
});

app.post('/api/quotes/price', async (req, res) => {
  const requestId = createRequestId();

  try {
    appendPrintIqLog({
      requestId,
      timestamp: new Date().toISOString(),
      type: 'request',
      tenantId: req.auth.tenantId,
      userId: req.auth.id,
      payload: req.body,
    });
    const token = await getLoginToken();
    const response = await fetch(`${printIqBaseUrl}/api/QuoteProcess/GetPrice?LoginToken=${encodeLoginToken(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const responseText = await response.text();
    const parsed = (() => {
      try {
        return JSON.parse(responseText);
      } catch {
        return responseText;
      }
    })();

    if (!response.ok) {
      appendPrintIqLog({
        requestId,
        timestamp: new Date().toISOString(),
        type: 'error',
        tenantId: req.auth.tenantId,
        userId: req.auth.id,
        response: parsed,
        status: response.status,
      });
      return res.status(response.status).json({
        error: 'PrintIQ quote request failed',
        details: parsed,
      });
    }

    if (parsed && typeof parsed === 'object' && parsed.IsError) {
      appendPrintIqLog({
        requestId,
        timestamp: new Date().toISOString(),
        type: 'error',
        tenantId: req.auth.tenantId,
        userId: req.auth.id,
        response: parsed,
        status: response.status,
      });

      return res.status(400).json({
        error: String(parsed.ErrorMessage || 'PrintIQ returned an error').trim(),
      });
    }

    appendPrintIqLog({
      requestId,
      timestamp: new Date().toISOString(),
      type: 'response',
      tenantId: req.auth.tenantId,
      userId: req.auth.id,
      response: parsed,
      status: response.status,
    });

    return res.json({
      amount: extractQuoteAmount(parsed),
    });
  } catch (error) {
    appendPrintIqLog({
      requestId,
      timestamp: new Date().toISOString(),
      type: 'error',
      tenantId: req.auth?.tenantId || null,
      userId: req.auth?.id || null,
      response: error instanceof Error ? error.message : 'Unknown quote error',
      status: 500,
    });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown quote error',
    });
  }
});

app.get('/api/admin/tenants', requireRoles('super_admin'), (_req, res) => {
  res.json({ tenants: listTenants() });
});

app.post('/api/admin/tenants', requireRoles('super_admin'), (req, res) => {
  try {
    const tenant = createTenant(req.body || {});
    res.status(201).json({ tenant });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create tenant' });
  }
});

app.get('/api/admin/users', requireRoles('super_admin', 'admin'), (req, res) => {
  const tenantId = req.auth.role === 'super_admin' ? String(req.query.tenantId || '') || undefined : req.auth.tenantId;
  res.json({ users: listUsers({ tenantId }) });
});

app.post('/api/admin/users', requireRoles('super_admin', 'admin'), (req, res) => {
  try {
    const targetTenantId =
      req.auth.role === 'super_admin'
        ? req.body?.tenantId || null
        : req.auth.tenantId;

    if (!canManageTargetTenant(req.auth, targetTenantId) && req.body?.role !== 'super_admin') {
      return res.status(403).json({ error: 'You cannot create users for another tenant' });
    }

    if (req.auth.role !== 'super_admin' && req.body?.role === 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can create a super admin user' });
    }

    const user = createUser({
      tenantId: targetTenantId,
      email: req.body?.email,
      password: req.body?.password,
      name: req.body?.name,
      role: req.body?.role,
    });

    return res.status(201).json({ user });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create user' });
  }
});

app.patch('/api/admin/users/:userId', requireRoles('super_admin', 'admin'), (req, res) => {
  try {
    const userId = req.params.userId;
    const targetTenantId =
      req.auth.role === 'super_admin'
        ? req.body?.tenantId ?? findTenantById(req.body?.tenantId || '')?.id ?? null
        : req.auth.tenantId;

    if (req.auth.role !== 'super_admin' && req.body?.role === 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can assign the super_admin role' });
    }

    const user = updateUser(userId, {
      name: req.body?.name,
      role: req.body?.role,
      active: req.body?.active,
      password: req.body?.password,
      tenantId: targetTenantId,
    });

    if (req.auth.role !== 'super_admin' && user.tenantId !== req.auth.tenantId) {
      return res.status(403).json({ error: 'You cannot move users to another tenant' });
    }

    return res.json({ user });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update user' });
  }
});

app.get('/api/admin/printiq-options/status', requireRoles('super_admin'), (_req, res) => {
  res.json(getOptionsCacheStatus());
});

app.post('/api/admin/printiq-options/refresh', requireRoles('super_admin'), async (_req, res) => {
  try {
    const result = await refreshOptionsCache();
    res.json({
      message: 'PrintIQ option cache refreshed successfully',
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to refresh PrintIQ option cache',
    });
  }
});

app.listen(port, () => {
  console.log(`FlowIQ proxy listening on http://localhost:${port}`);
});

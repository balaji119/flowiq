require('dotenv').config({ quiet: true });

const cors = require('cors');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { calculateCampaign, formatKeys, workbookMetadata } = require('./workbookCalculator');

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

function appendPrintIqLog(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(printIqLogPath, line, 'utf8');
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    printIqBaseUrl,
  });
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
      payload: req.body,
    });
    const token = await getLoginToken();
    const response = await fetch(`${printIqBaseUrl}/api/QuoteProcess/GetPrice?LoginToken=${encodeURIComponent(token)}`, {
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
        response: parsed,
        status: response.status,
      });
      return res.status(response.status).json({
        error: 'PrintIQ quote request failed',
        details: parsed,
      });
    }

    appendPrintIqLog({
      requestId,
      timestamp: new Date().toISOString(),
      type: 'response',
      response: parsed,
      status: response.status,
    });

    return res.json({
      token,
      result: parsed,
    });
  } catch (error) {
    appendPrintIqLog({
      requestId,
      timestamp: new Date().toISOString(),
      type: 'error',
      response: error instanceof Error ? error.message : 'Unknown quote error',
      status: 500,
    });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown quote error',
    });
  }
});

app.listen(port, () => {
  console.log(`FlowIQ proxy listening on http://localhost:${port}`);
});

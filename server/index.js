require('dotenv').config({ quiet: true });

const cors = require('cors');
const express = require('express');

const app = express();
const port = Number(process.env.PORT || 4000);
const printIqBaseUrl = process.env.PRINTIQ_BASE_URL || 'https://adsaust.printiq.com';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function getLoginToken() {
  const params = new URLSearchParams({
    UserName: getRequiredEnv('PRINTIQ_USERNAME'),
    Password: getRequiredEnv('PRINTIQ_PASSWORD'),
    ApplicationName: getRequiredEnv('PRINTIQ_APPLICATION_NAME'),
    ApplicationKey: getRequiredEnv('PRINTIQ_APPLICATION_KEY'),
  });

  const response = await fetch(`${printIqBaseUrl}/api/QuoteProcess/GetApplicationLogInToken?${params.toString()}`);
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Token request failed (${response.status}): ${bodyText}`);
  }

  return bodyText.replace(/^"|"$/g, '').trim();
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    printIqBaseUrl,
  });
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
  try {
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
      return res.status(response.status).json({
        error: 'PrintIQ quote request failed',
        details: parsed,
      });
    }

    return res.json({
      token,
      result: parsed,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown quote error',
    });
  }
});

app.listen(port, () => {
  console.log(`FlowIQ proxy listening on http://localhost:${port}`);
});

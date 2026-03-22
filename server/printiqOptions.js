const fs = require('fs');
const path = require('path');

const dataDirectory = path.join(__dirname, 'data');
const stockDefinitionsPath = path.join(dataDirectory, 'printiq-stock-definitions.json');
const processTypesPath = path.join(dataDirectory, 'printiq-process-types.json');
const printIqBaseUrl = process.env.PRINTIQ_BASE_URL || 'https://adsaust.printiq.com';

const defaultJobOperations = [
  { label: 'Preflight', operationName: 'Preflight', enabledByDefault: true },
  { label: 'Proof PDF', operationName: '* PROOF PDF', enabledByDefault: true },
  { label: 'File Setup', operationName: '*FILE SETUP ADS', enabledByDefault: true },
  { label: 'Auto to Press', operationName: 'Auto to Press', enabledByDefault: true },
  { label: 'Standard Pack and Wrap', operationName: '* Standard Pack and Wrap', enabledByDefault: true },
];

const defaultSectionOperations = [
  { label: 'Cut - Kongsberg Table Cutter', operationName: 'CUT - Kongsberg Table Cutter', enabledByDefault: true },
  { label: 'Trim to Size', operationName: 'Trim to Size' },
  { label: 'Drill Holes', operationName: 'Drill Holes' },
  { label: 'Round Corners', operationName: 'Round Corners' },
];

const loginTokenCache = {
  token: null,
  expiresAt: 0,
};

function ensureDataDirectory() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }
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

function getAccessToken() {
  return process.env.PRINTIQ_ACCESS_TOKEN || '';
}

function getCachedLoginToken() {
  if (loginTokenCache.token && Date.now() < loginTokenCache.expiresAt) {
    return loginTokenCache.token;
  }

  return null;
}

function setCachedLoginToken(token) {
  loginTokenCache.token = token;
  loginTokenCache.expiresAt = Date.now() + 10 * 60 * 1000;
}

function clearCachedLoginToken() {
  loginTokenCache.token = null;
  loginTokenCache.expiresAt = 0;
}

async function getLoginToken() {
  const cachedToken = getCachedLoginToken();
  if (cachedToken) {
    return cachedToken;
  }

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
      const token = bodyText.replace(/^"|"$/g, '').trim();
      setCachedLoginToken(token);
      return token;
    }

    failures.push(`${attempt.name} -> (${response.status}) ${bodyText}`);

    if (![400, 404, 405].includes(response.status)) {
      break;
    }
  }

  throw new Error(`Token request failed. Attempts: ${failures.join(' | ')}`);
}

async function fetchWithLoginToken(url, loginToken) {
  const encodedLoginToken = encodeLoginToken(loginToken);
  const attempts = [
    {
      name: 'querystring login token',
      requestUrl: url.includes('?') ? `${url}&LoginToken=${encodedLoginToken}` : `${url}?LoginToken=${encodedLoginToken}`,
      init: {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    },
    {
      name: 'LoginToken header',
      requestUrl: url,
      init: {
        headers: {
          'Content-Type': 'application/json',
          LoginToken: encodedLoginToken,
        },
      },
    },
    {
      name: 'PrintIQ-Login-Token header',
      requestUrl: url,
      init: {
        headers: {
          'Content-Type': 'application/json',
          'PrintIQ-Login-Token': encodedLoginToken,
        },
      },
    },
    {
      name: 'Authorization bearer token',
      requestUrl: url,
      init: {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${encodedLoginToken}`,
        },
      },
    },
    {
      name: 'Authorization raw token',
      requestUrl: url,
      init: {
        headers: {
          'Content-Type': 'application/json',
          Authorization: encodedLoginToken,
        },
      },
    },
  ];

  const failures = [];

  for (const attempt of attempts) {
    const response = await fetch(attempt.requestUrl, attempt.init);

    if (response.ok) {
      return response;
    }

    const body = await response.text();
    failures.push(`${attempt.name} -> (${response.status}) ${body}`);

    if (![400, 401, 403, 404, 405].includes(response.status)) {
      break;
    }
  }

  throw new Error(`PrintIQ options request failed. Attempts: ${failures.join(' | ')}`);
}

async function fetchWithAccessToken(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      'PrintIQ-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PrintIQ options request failed (${response.status}): ${body}`);
  }

  return response;
}

async function fetchAllODataPages(baseUrl) {
  const accessToken = getAccessToken();
  let nextUrl = baseUrl;
  const results = [];

  while (nextUrl) {
    let response;

    if (accessToken) {
      response = await fetchWithAccessToken(nextUrl, accessToken);
    } else {
      try {
        response = await fetchWithLoginToken(nextUrl, await getLoginToken());
      } catch (firstError) {
        clearCachedLoginToken();

        try {
          response = await fetchWithLoginToken(nextUrl, await getLoginToken());
        } catch (retryError) {
          throw new Error(
            retryError instanceof Error
              ? retryError.message
              : firstError instanceof Error
                ? firstError.message
                : 'PrintIQ options request failed.',
          );
        }
      }
    }

    const data = await response.json();
    results.push(...(data.value || []));
    nextUrl = data['@odata.nextLink'] || null;
  }

  return results;
}

function readCache(filePath, fallbackValue = []) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : fallbackValue;
}

function writeCache(filePath, data) {
  ensureDataDirectory();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getCacheFileMetadata(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      cached: false,
      count: 0,
      updatedAt: null,
    };
  }

  const stats = fs.statSync(filePath);
  const data = readCache(filePath, []);

  return {
    cached: true,
    count: data.length,
    updatedAt: stats.mtime.toISOString(),
  };
}

async function getStockDefinitions({ forceRefresh = false } = {}) {
  if (!forceRefresh && fs.existsSync(stockDefinitionsPath)) {
    return readCache(stockDefinitionsPath, []);
  }

  const rawStocks = await fetchAllODataPages(`${printIqBaseUrl}/api/v1/odata/StockDefinitions`);
  const stocks = rawStocks
    .map((stock) => ({
      value: stock.Code,
      label: stock.Code,
      description: stock.Description || '',
    }))
    .filter((stock) => stock.value);

  writeCache(stockDefinitionsPath, stocks);
  return stocks;
}

async function getProcessTypes({ forceRefresh = false } = {}) {
  if (!forceRefresh && fs.existsSync(processTypesPath)) {
    return readCache(processTypesPath, []);
  }

  const rawProcesses = await fetchAllODataPages(`${printIqBaseUrl}/api/v1/odata/Processes`);
  const processTypes = rawProcesses
    .map((process) => process.Description)
    .filter((description) => typeof description === 'string' && description.trim())
    .map((description) => ({
      value: description,
      label: description,
    }));

  writeCache(processTypesPath, processTypes);
  return processTypes;
}

async function searchStockDefinitions(query = '') {
  const stocks = await getStockDefinitions();
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? stocks.filter(
        (stock) =>
          stock.value.toLowerCase().includes(normalizedQuery) ||
          stock.description.toLowerCase().includes(normalizedQuery),
      )
    : stocks;

  return filtered.slice(0, 20);
}

async function searchProcessTypes(query = '') {
  const processTypes = await getProcessTypes();
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? processTypes.filter((process) => process.value.toLowerCase().includes(normalizedQuery))
    : processTypes;

  return filtered.slice(0, 20);
}

function getQuoteFormOptions() {
  return {
    jobOperations: defaultJobOperations,
    sectionOperations: defaultSectionOperations,
  };
}

function getOptionsCacheStatus() {
  return {
    stocks: getCacheFileMetadata(stockDefinitionsPath),
    processes: getCacheFileMetadata(processTypesPath),
  };
}

async function refreshOptionsCache() {
  const [stocks, processes] = await Promise.all([
    getStockDefinitions({ forceRefresh: true }),
    getProcessTypes({ forceRefresh: true }),
  ]);

  return {
    stocks: {
      count: stocks.length,
      updatedAt: getCacheFileMetadata(stockDefinitionsPath).updatedAt,
    },
    processes: {
      count: processes.length,
      updatedAt: getCacheFileMetadata(processTypesPath).updatedAt,
    },
  };
}

module.exports = {
  getProcessTypes,
  getOptionsCacheStatus,
  getQuoteFormOptions,
  getStockDefinitions,
  refreshOptionsCache,
  searchProcessTypes,
  searchStockDefinitions,
};

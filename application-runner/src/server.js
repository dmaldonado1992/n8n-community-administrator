import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { platformDefinitions } from './platforms.js';
import { ApplicationRunner } from './runner.js';
import { applicationSchema, resumeSchema } from './schema.js';
import { assertAuthorized } from './security.js';
import { SteelProvider } from './steel.js';

const env = process.env;
const port = Number(env.PORT || 10000);
const apiToken = env.APPLICATION_RUNNER_TOKEN || '';
const provider = new SteelProvider({ baseUrl: env.STEEL_BASE_URL || 'https://api.steel.dev', apiKey: env.STEEL_API_KEY || '' });
const runner = new ApplicationRunner(provider);
const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'job-application-platform-runner', platforms: platformDefinitions.size, browserProviderConfigured: Boolean(env.STEEL_API_KEY || env.STEEL_BASE_URL) });
});

function platformHandler(definition, operation) {
  return async (request, response, next) => {
    try {
      assertAuthorized(request, apiToken);
      const payload = operation === 'apply' ? applicationSchema.parse(request.body) : resumeSchema.parse(request.body);
      const result = operation === 'apply' ? await runner.apply(definition, payload) : await runner.resume(definition, payload);
      response.status(result.status === 'manual_required' ? 202 : 200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

for (const definition of platformDefinitions.values()) {
  app.post(`/v1/${definition.slug}/apply`, platformHandler(definition, 'apply'));
  app.post(`/v1/${definition.slug}/resume`, platformHandler(definition, 'resume'));
}

app.use((error, _request, response, _next) => {
  const requestId = crypto.randomUUID();
  const status = Number(error.statusCode || (error.name === 'ZodError' ? 400 : 500));
  console.error(JSON.stringify({ level: 'error', requestId, message: error.message }));
  response.status(status).json({ ok: false, requestId, error: status >= 500 ? 'Application runner failed' : error.message });
});

app.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', message: 'application runner listening', port, platforms: platformDefinitions.size }));
});


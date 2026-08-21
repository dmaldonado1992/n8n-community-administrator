import assert from 'node:assert/strict';
import test from 'node:test';
import { notionPlatformToSlug, platformDefinitions } from '../src/platforms.js';

test('exposes one adapter for every Notion platform option', () => {
  const expected = ['Indeed', 'ZipRecruiter', 'Remote.com', 'We Work Remotely', 'Remote OK', 'Remotive', 'Working Nomads', 'Jobspresso', 'LinkedIn', 'Glassdoor', 'Wellfound', 'Dice', 'Torre', 'Get on Board', 'Computrabajo', 'Tecoloco', 'Empresa directa', 'Direct'];
  assert.equal(platformDefinitions.size, expected.length);
  for (const name of expected) assert.ok(notionPlatformToSlug[name], `missing ${name}`);
});

test('uses separate apply and resume paths per platform', () => {
  const paths = [...platformDefinitions.keys()].flatMap((slug) => [`/v1/${slug}/apply`, `/v1/${slug}/resume`]);
  assert.equal(new Set(paths).size, platformDefinitions.size * 2);
});


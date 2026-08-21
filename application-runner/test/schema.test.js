import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationSchema } from '../src/schema.js';

const valid = {
  applicationId: 'test-1',
  notionPageId: 'page-1',
  jobUrl: 'https://www.linkedin.com/jobs/view/123',
  candidate: { firstName: 'Test', lastName: 'Candidate', email: 'test@example.invalid' },
  resumeText: 'Controlled test resume content that is not submitted.',
  approvalSource: 'notion_apply_button',
  approvedAt: '2026-08-21T00:00:00.000Z',
  dryRun: true,
};

test('requires explicit Notion approval evidence', () => {
  assert.equal(applicationSchema.safeParse(valid).success, true);
  assert.equal(applicationSchema.safeParse({ ...valid, approvalSource: 'api' }).success, false);
});

test('rejects incomplete candidate data', () => {
  assert.equal(applicationSchema.safeParse({ ...valid, candidate: { firstName: '', lastName: '', email: 'bad' } }).success, false);
});


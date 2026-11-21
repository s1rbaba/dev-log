import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmpty, monthMeta, renderEntry, summarize, upsertEntry } from './format.mjs';

const SINCE = Date.parse('2026-11-20T06:00:00Z');
const UNTIL = Date.parse('2026-11-21T06:00:00Z');

function makeEvent(type, payload, { at = '2026-11-20T18:00:00Z', repo = 'sabab/astra-calculator' } = {}) {
  return { type, payload, created_at: at, repo: { name: repo } };
}

const pr = (number, title, merged = false) => ({
  number,
  title,
  html_url: `https://github.com/sabab/astra-calculator/pull/${number}`,
  merged_at: merged ? '2026-11-20T19:00:00Z' : null,
});

test('counts distinct commits per repository inside the window', () => {
  const events = [
    makeEvent('PushEvent', { size: 3, distinct_size: 3 }, { at: '2026-11-20T10:00:00Z', repo: 'sabab/api' }),
    makeEvent('PushEvent', { size: 2, distinct_size: 2 }, { at: '2026-11-20T11:00:00Z', repo: 'sabab/api' }),
    makeEvent('PushEvent', { size: 1, distinct_size: 1 }, { at: '2026-11-20T12:00:00Z', repo: 'sabab/web' }),
    makeEvent('PushEvent', { size: 9, distinct_size: 9 }, { at: '2026-11-19T12:00:00Z', repo: 'sabab/old' }),
    makeEvent('PushEvent', { size: 4, distinct_size: 4 }, { at: '2026-11-20T13:00:00Z', repo: 'sabab/dev-log' }),
  ];

  const summary = summarize(events, { since: SINCE, until: UNTIL, exclude: ['sabab/dev-log'] });

  assert.equal(summary.totalCommits, 6);
  assert.deepEqual(summary.commitList.map(({ repo, count }) => [repo, count]), [
    ['sabab/api', 5],
    ['sabab/web', 1],
  ]);
});

test('classifies pull request events', () => {
  const events = [
    makeEvent('PullRequestEvent', { action: 'opened', pull_request: pr(1, 'Add rate limiting') }),
    makeEvent('PullRequestEvent', { action: 'closed', pull_request: pr(2, 'Fix pagination', true) }),
    makeEvent('PullRequestEvent', { action: 'closed', pull_request: pr(3, 'Abandoned spike') }),
  ];

  const summary = summarize(events, { since: SINCE, until: UNTIL });

  assert.equal(summary.prsOpened.length, 1);
  assert.equal(summary.prsMerged.length, 1);
  assert.equal(summary.prsClosed.length, 1);
  assert.equal(summary.prsMerged[0].title, 'Fix pagination');
});

test('collects issues, reviews, and releases', () => {
  const issue = (number, title) => ({
    number,
    title,
    html_url: `https://github.com/sabab/web/issues/${number}`,
  });

  const events = [
    makeEvent('IssuesEvent', { action: 'opened', issue: issue(7, 'Dark mode flicker') }, { repo: 'sabab/web' }),
    makeEvent('IssuesEvent', { action: 'closed', issue: issue(8, 'Typo in docs') }, { repo: 'sabab/web' }),
    makeEvent('PullRequestReviewEvent', {
      action: 'submitted',
      pull_request: pr(4, 'Refactor parser'),
      review: { state: 'APPROVED' },
    }),
    makeEvent('ReleaseEvent', {
      action: 'published',
      release: {
        name: 'v1.2.0',
        tag_name: 'v1.2.0',
        html_url: 'https://github.com/sabab/api/releases/tag/v1.2.0',
      },
    }, { repo: 'sabab/api' }),
  ];

  const summary = summarize(events, { since: SINCE, until: UNTIL });

  assert.equal(summary.issuesOpened.length, 1);
  assert.equal(summary.issuesClosed.length, 1);
  assert.equal(summary.reviews.length, 1);
  assert.equal(summary.reviews[0].state, 'approved');
  assert.equal(summary.releases[0].name, 'v1.2.0');
});

test('keeps one review line per pull request', () => {
  const events = [
    makeEvent('PullRequestReviewEvent', { pull_request: pr(4, 'Refactor'), review: { state: 'COMMENTED' } }),
    makeEvent('PullRequestReviewEvent', { pull_request: pr(4, 'Refactor'), review: { state: 'APPROVED' } }),
  ];

  const summary = summarize(events, { since: SINCE, until: UNTIL });

  assert.equal(summary.reviews.length, 1);
  assert.equal(summary.reviews[0].state, 'approved');
});

test('detects an empty day', () => {
  const summary = summarize([], { since: SINCE, until: UNTIL });
  assert.equal(isEmpty(summary), true);
});

test('renders a readable entry', () => {
  const events = [
    makeEvent('PushEvent', { distinct_size: 6, size: 6 }),
    makeEvent('PullRequestEvent', {
      action: 'closed',
      pull_request: pr(9, 'Fix [parser] bug', true),
    }, { repo: 'sabab/api' }),
    makeEvent('IssuesEvent', {
      action: 'opened',
      issue: { number: 3, title: 'Add dark mode', html_url: 'https://github.com/sabab/web/issues/3' },
    }, { repo: 'sabab/web' }),
  ];

  const summary = summarize(events, { since: SINCE, until: UNTIL });
  const meta = monthMeta(new Date('2026-11-21T12:00:00Z'), 'UTC');
  const entry = renderEntry(summary, meta);

  assert.equal(entry.heading, 'Sat, Nov 21');
  assert.match(entry.body, /- \*\*6 commits\*\* across 1 repository: `sabab\/astra-calculator` \(6\)/);
  assert.match(entry.body, /Merged PR \[#9\]/);
  assert.ok(entry.body.includes('Fix \\[parser\\] bug'));
  assert.match(entry.body, /Opened issue \[#3\]/);
});

test('builds month metadata in the requested timezone', () => {
  const utc = monthMeta(new Date('2026-11-21T12:00:00Z'), 'UTC');
  assert.deepEqual(utc, {
    iso: '2026-11-21',
    key: '2026-11',
    title: 'November 2026',
    heading: 'Sat, Nov 21',
  });

  const ny = monthMeta(new Date('2026-11-21T02:00:00Z'), 'America/New_York');
  assert.equal(ny.iso, '2026-11-20');
  assert.equal(ny.heading, 'Fri, Nov 20');
});

test('creates a month file with a header', () => {
  const meta = monthMeta(new Date('2026-11-21T12:00:00Z'), 'UTC');
  const file = upsertEntry('', meta, { heading: 'Sat, Nov 21', body: '- **1 commit**' });

  assert.match(file, /^# November 2026\n\n_Generated from real GitHub activity\./);
  assert.match(file, /## Sat, Nov 21\n\n- \*\*1 commit\*\*/);
});

test('replaces the same day instead of duplicating it', () => {
  const meta = monthMeta(new Date('2026-11-21T12:00:00Z'), 'UTC');
  const first = upsertEntry('', meta, { heading: 'Sat, Nov 21', body: '- **1 commit**' });
  const second = upsertEntry(first, meta, { heading: 'Sat, Nov 21', body: '- **2 commits**' });

  assert.equal((second.match(/## Sat, Nov 21/g) || []).length, 1);
  assert.ok(second.includes('**2 commits**'));
  assert.ok(!second.includes('**1 commit**'));
});

test('adds newer days at the top and keeps older ones', () => {
  const meta = monthMeta(new Date('2026-11-21T12:00:00Z'), 'UTC');
  const first = upsertEntry('', meta, { heading: 'Fri, Nov 20', body: '- **1 commit**' });
  const second = upsertEntry(first, meta, { heading: 'Sat, Nov 21', body: '- **2 commits**' });

  assert.ok(second.indexOf('## Sat, Nov 21') < second.indexOf('## Fri, Nov 20'));
  assert.ok(second.includes('**1 commit**'));
  assert.ok(second.includes('**2 commits**'));
});

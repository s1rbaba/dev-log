#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isEmpty, monthMeta, renderEntry, summarize, upsertEntry } from './format.mjs';

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const login = argValue('login') || process.env.GH_LOGIN || '';
const token = process.env.GH_TOKEN || '';
const hours = Number(argValue('hours') || process.env.LOG_HOURS || 24);
const timeZone = argValue('tz') || process.env.LOG_TZ || 'UTC';
const outDir = path.resolve(argValue('out') || 'log');
const fixture = argValue('fixture');
const dryRun = process.argv.includes('--dry-run');
const exclude = (argValue('exclude') || process.env.LOG_EXCLUDE || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

async function fetchEvents(username, since) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'daily-dev-log',
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const events = [];
  for (let page = 1; page <= 3; page += 1) {
    const url = `https://api.github.com/users/${encodeURIComponent(username)}/events?per_page=100&page=${page}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`GitHub API ${response.status} for ${url}\n${detail}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    events.push(...batch);

    const oldest = Date.parse(batch[batch.length - 1].created_at);
    if (Number.isFinite(oldest) && oldest < since) break;
  }
  return events;
}

async function main() {
  if (!login && !fixture) {
    console.error('No GitHub login. Set GH_LOGIN or pass --login <username>.');
    process.exit(1);
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 720) {
    console.error(`Invalid window: ${hours}. Use a number of hours between 1 and 720.`);
    process.exit(1);
  }

  const now = new Date();
  const since = new Date(now.getTime() - hours * 3_600_000);
  const events = fixture
    ? JSON.parse(fs.readFileSync(fixture, 'utf8').replace(/^\uFEFF/, ''))
    : await fetchEvents(login, since.getTime());

  const meta = monthMeta(now, timeZone);
  const summary = summarize(events, {
    since: since.getTime(),
    until: now.getTime(),
    exclude,
  });
  const entry = renderEntry(summary, meta, { windowHours: hours });

  if (isEmpty(summary)) {
    const who = login ? ` for ${login}` : '';
    console.log(`No activity${who} in the last ${hours}h — nothing to write.`);
    return;
  }

  const file = path.join(outDir, `${meta.key}.md`);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = upsertEntry(existing, meta, entry);

  if (dryRun) {
    console.log(`--- ${file} (dry run) ---`);
    console.log(next);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, next);
  console.log(`Updated ${file}`);
  console.log(entry.body.split('\n').map((line) => `  ${line}`).join('\n'));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

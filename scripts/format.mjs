const MAX_DETAILS = 12;
const MAX_REPOS = 4;

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/([\[\]])/g, '\\$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function safeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function monthMeta(date, timeZone = 'UTC') {
  const zone = safeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
  const iso = `${part('year')}-${part('month')}-${part('day')}`;

  return {
    iso,
    key: iso.slice(0, 7),
    title: new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      month: 'long',
      year: 'numeric',
    }).format(date),
    heading: new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date),
  };
}

export function summarize(events, { since, until, exclude = [] }) {
  const excluded = new Set(exclude);
  const commits = new Map();
  const opened = new Map();
  const merged = new Map();
  const closed = new Map();
  const issuesOpened = new Map();
  const issuesClosed = new Map();
  const reviews = new Map();
  const releases = new Map();

  const remember = (map, item) => {
    if (item.url && !map.has(item.url)) map.set(item.url, item);
  };

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const at = Date.parse(event.created_at);
    if (!Number.isFinite(at) || at < since || at >= until) continue;

    const repo = event.repo?.name;
    if (!repo || excluded.has(repo)) continue;

    const payload = event.payload ?? {};

    switch (event.type) {
      case 'PushEvent': {
        const count = Number(payload.distinct_size ?? payload.size ?? 0) || 0;
        if (count > 0) commits.set(repo, (commits.get(repo) ?? 0) + count);
        break;
      }

      case 'PullRequestEvent': {
        const pr = payload.pull_request;
        if (!pr) break;
        const item = {
          repo,
          number: pr.number,
          title: pr.title ?? '',
          url: pr.html_url,
        };
        if (payload.action === 'opened') remember(opened, item);
        else if (payload.action === 'closed') remember(pr.merged_at ? merged : closed, item);
        break;
      }

      case 'IssuesEvent': {
        const issue = payload.issue;
        if (!issue) break;
        const item = {
          repo,
          number: issue.number,
          title: issue.title ?? '',
          url: issue.html_url,
        };
        if (payload.action === 'opened') remember(issuesOpened, item);
        else if (payload.action === 'closed') remember(issuesClosed, item);
        break;
      }

      case 'PullRequestReviewEvent': {
        const pr = payload.pull_request;
        if (!pr) break;
        reviews.set(`${repo}#${pr.number}`, {
          repo,
          number: pr.number,
          title: pr.title ?? '',
          url: pr.html_url,
          state: String(payload.review?.state ?? '').toLowerCase(),
        });
        break;
      }

      case 'ReleaseEvent': {
        if (payload.action !== 'published' || !payload.release) break;
        remember(releases, {
          repo,
          name: payload.release.name || payload.release.tag_name || 'release',
          url: payload.release.html_url,
        });
        break;
      }

      default:
        break;
    }
  }

  const commitList = [...commits.entries()]
    .map(([repo, count]) => ({ repo, count }))
    .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo));

  return {
    totalCommits: commitList.reduce((sum, item) => sum + item.count, 0),
    commitList,
    prsOpened: [...opened.values()],
    prsMerged: [...merged.values()],
    prsClosed: [...closed.values()],
    issuesOpened: [...issuesOpened.values()],
    issuesClosed: [...issuesClosed.values()],
    reviews: [...reviews.values()],
    releases: [...releases.values()],
  };
}

export function isEmpty(summary) {
  return summary.totalCommits === 0
    && summary.prsOpened.length === 0
    && summary.prsMerged.length === 0
    && summary.prsClosed.length === 0
    && summary.issuesOpened.length === 0
    && summary.issuesClosed.length === 0
    && summary.reviews.length === 0
    && summary.releases.length === 0;
}

export function renderEntry(summary, meta) {
  const lines = [];

  if (summary.totalCommits > 0) {
    const repos = summary.commitList
      .slice(0, MAX_REPOS)
      .map((item) => `\`${item.repo}\` (${item.count})`)
      .join(', ');
    const extra = summary.commitList.length > MAX_REPOS
      ? ` +${summary.commitList.length - MAX_REPOS} more`
      : '';
    lines.push(
      `- **${plural(summary.totalCommits, 'commit', 'commits')}** across `
      + `${plural(summary.commitList.length, 'repository', 'repositories')}: ${repos}${extra}`,
    );
  }

  const details = [];

  for (const pr of summary.prsMerged) {
    details.push(`Merged PR [#${pr.number}](${pr.url}) "${escapeText(pr.title)}" in \`${pr.repo}\``);
  }
  for (const pr of summary.prsOpened) {
    details.push(`Opened PR [#${pr.number}](${pr.url}) "${escapeText(pr.title)}" in \`${pr.repo}\``);
  }
  for (const pr of summary.prsClosed) {
    details.push(`Closed PR [#${pr.number}](${pr.url}) "${escapeText(pr.title)}" in \`${pr.repo}\``);
  }
  for (const issue of summary.issuesOpened) {
    details.push(`Opened issue [#${issue.number}](${issue.url}) "${escapeText(issue.title)}" in \`${issue.repo}\``);
  }
  for (const issue of summary.issuesClosed) {
    details.push(`Closed issue [#${issue.number}](${issue.url}) "${escapeText(issue.title)}" in \`${issue.repo}\``);
  }
  for (const review of summary.reviews) {
    const suffix = review.state ? ` (${review.state.replace(/_/g, ' ')})` : '';
    details.push(
      `Reviewed PR [#${review.number}](${review.url}) "${escapeText(review.title)}" `
      + `in \`${review.repo}\`${suffix}`,
    );
  }
  for (const release of summary.releases) {
    details.push(`Published [${escapeText(release.name)}](${release.url}) in \`${release.repo}\``);
  }

  lines.push(...details.slice(0, MAX_DETAILS).map((line) => `- ${line}`));
  if (details.length > MAX_DETAILS) {
    lines.push(`- _…and ${details.length - MAX_DETAILS} more_`);
  }
  if (lines.length === 0) lines.push('- _No activity._');

  return { heading: meta.heading, body: lines.join('\n') };
}

function splitLog(markdown) {
  const match = markdown.match(/^## /m);
  if (!match) return { header: markdown.trim(), sections: [] };

  const header = markdown.slice(0, match.index).trim();
  const chunks = markdown.slice(match.index).split(/^## /m).filter(Boolean);
  const sections = chunks.map((chunk) => {
    const newline = chunk.indexOf('\n');
    const heading = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
    const body = newline === -1 ? '' : chunk.slice(newline + 1).trim();
    return { heading, body };
  });

  return { header, sections };
}

export function upsertEntry(existing, meta, entry) {
  const parsed = existing ? splitLog(existing) : { header: '', sections: [] };
  const header = parsed.header
    || `# ${meta.title}\n\n_Generated from real GitHub activity. Days without activity are omitted._`;

  const sections = parsed.sections.filter((section) => section.heading !== entry.heading);
  sections.unshift({ heading: entry.heading, body: entry.body.trim() });

  const body = sections
    .map((section) => `## ${section.heading}\n\n${section.body}\n`)
    .join('\n');

  return `${header}\n\n${body}`;
}

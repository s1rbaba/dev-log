# Setup

This repo is a small automation, not a project. It takes about five minutes to get running.

## 1. Create the repository

Create a new **public** repository named `dev-log` (or anything you like) and push these files to it.

A private repo works too — enable **Include private contributions on my profile** in GitHub → Settings → Public profile so the commits appear on your graph.

## 2. Let the commits count as yours

The workflow commits with your name and email so the entries land on your contribution graph. By default it uses `<your-username>@users.noreply.github.com`.

If your account uses the newer `ID+username@users.noreply.github.com` form, set a repository variable:

- **Settings → Secrets and variables → Actions → Variables → New repository variable**
- `EMAIL` — the exact address from **Settings → Emails**

Optional variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOGIN` | repository owner | The account whose activity is logged. Set this if the repo lives under an organization. |
| `EMAIL` | `<LOGIN>@users.noreply.github.com` | Commit author email. |
| `TZ` | `UTC` | Timezone for the date labels, e.g. `America/New_York`. |

## 3. Include private activity (optional)

`GITHUB_TOKEN` can only see public activity. To log work in private repos, create a classic personal access token with `read:user` and `repo` scopes and save it as a secret named `ACTIVITY_TOKEN`.

## 4. Test it

Actions → **Daily dev log** → **Run workflow**. If you've had activity in the last 24 hours, a new file appears in `log/`.

The schedule runs daily at 06:17 UTC. Scheduled workflows are paused after 60 days without repository activity; re-enable it from the Actions tab if that happens.

## How it works

1. `scripts/build-log.mjs` fetches your recent events from the GitHub API.
2. `scripts/format.mjs` turns them into a Markdown entry: commit counts per repo, PRs opened/merged, issues, reviews, releases.
3. The workflow commits the entry with your identity.

The repository itself is excluded from the summary, so the log never counts its own commits. No activity means no commit.

Run the tests with `npm test`.

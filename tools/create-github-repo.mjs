/**
 * Creates the GitHub repository for this project if it does not exist.
 *
 * Reads GH_TOKEN (a personal access token) from the environment; it is never
 * printed. Run via tools/publish.ps1, which supplies the token from the
 * machine's credential manager.
 */

const token = process.env.GH_TOKEN;
if (!token) {
  console.error('GH_TOKEN is not set');
  process.exit(1);
}

const NAME = process.env.GH_REPO ?? 'galaga-redux';
const DESCRIPTION =
  'Galaga reimplemented on a single deterministic engine and rendered twice: ' +
  'authentic 224x288 pixel art and a Three.js enhanced view, with an expert ' +
  'autopilot, the arcade no-fire bug and a Cloudflare Worker deployment.';

const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'galaga-redux-publish',
  'content-type': 'application/json',
};

async function api(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, { headers, ...init });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const me = await api('/user');
if (me.status !== 200) {
  console.error('cannot read /user:', me.status, JSON.stringify(me.body).slice(0, 300));
  process.exit(1);
}
const owner = me.body.login;
console.log(`authenticated as ${owner}`);

const existing = await api(`/repos/${owner}/${NAME}`);
if (existing.status === 200) {
  console.log(`repository already exists: ${existing.body.html_url}`);
  console.log(`default branch: ${existing.body.default_branch}`);
  process.exit(0);
}

const created = await api('/user/repos', {
  method: 'POST',
  body: JSON.stringify({
    name: NAME,
    description: DESCRIPTION,
    private: false,
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  }),
});
if (created.status !== 201) {
  console.error('create failed:', created.status, JSON.stringify(created.body).slice(0, 400));
  process.exit(1);
}
console.log(`created ${created.body.html_url}`);
console.log(`clone url: ${created.body.clone_url}`);

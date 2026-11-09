// Mock channel APIs for local development and tests. No dependencies.
// Behaves like the real providers closely enough to exercise the publisher:
//   LinkedIn Posts API, Indeed Job Sync (GraphQL), Naukri webhooks, and a generic job board.
// Fault injection: put "[fail:429]", "[fail:500]" or "[fail:401]" anywhere in the post text / job title.
import { createServer } from 'node:http';

const log = [];
let seq = 1000;
const store = new Map();

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  const url = new URL(req.url, 'http://x');
  const entry = { at: new Date().toISOString(), method: req.method, path: url.pathname, auth: req.headers.authorization ?? null, body };
  if (url.pathname !== '/_log') { log.push(entry); if (log.length > 500) log.shift(); console.log(req.method, url.pathname); }

  // Backslashes allowed because LinkedIn commentary escapes [ and ].
  const fail = /\[fail:(\d{3})\\*\]/.exec(raw.replace(/\\+\[/g, '['));
  if (fail) return send(res, Number(fail[1]), { message: `mock failure ${fail[1]}` }, fail[1] === '429' ? { 'retry-after': '1' } : {});

  if (url.pathname === '/_log') return req.method === 'DELETE' ? (log.length = 0, send(res, 204)) : send(res, 200, log);
  if (url.pathname === '/health') return send(res, 200, { ok: true });

  // LinkedIn Posts API: POST /linkedin/rest/posts → 201 + x-restli-id
  if (url.pathname === '/linkedin/rest/posts' && req.method === 'POST') {
    if (!req.headers.authorization) return send(res, 401, { message: 'missing token' });
    const id = `urn:li:share:${++seq}`;
    store.set(id, body);
    return send(res, 201, undefined, { 'x-restli-id': id });
  }
  if (url.pathname.startsWith('/linkedin/rest/posts/') && req.method === 'DELETE') return send(res, 204);
  if (url.pathname === '/linkedin/v2/userinfo') return send(res, 200, { sub: 'mock-member-123', name: 'Mock Recruiter', email: 'recruiter@championsmail.com' });

  // Indeed Job Sync (GraphQL-ish)
  if (url.pathname === '/indeed/graphql') {
    const op = body?.operationName ?? 'createSourcedJobPostings';
    if (op.startsWith('expire')) return send(res, 200, { data: { jobsIngest: { expireSourcedJobsBySourcedPostingId: { results: [{ ok: true }] } } } });
    const id = `indeed-${++seq}`;
    return send(res, 200, { data: { jobsIngest: { createSourcedJobPostings: { results: [{ jobPosting: { sourcedPostingId: id } }] } } } });
  }

  // Naukri integration webhooks
  if (url.pathname === '/naukri/jobs' && req.method === 'POST') return send(res, 201, { jobId: `NK${++seq}`, url: `https://www.naukri.com/job-listings-mock-${seq}` });
  if (url.pathname.startsWith('/naukri/jobs/')) return send(res, req.method === 'DELETE' ? 200 : 200, { ok: true });

  // Generic job board
  if (url.pathname === '/board/jobs' && req.method === 'POST') {
    const id = `board-${++seq}`;
    store.set(id, body);
    return send(res, 201, { id, url: `http://localhost:9000/board/jobs/${id}` });
  }
  if (url.pathname.startsWith('/board/jobs/')) {
    const id = url.pathname.split('/').pop();
    if (req.method === 'DELETE') { store.delete(id); return send(res, 204); }
    if (req.method === 'PUT') { store.set(id, body); return send(res, 200, { id }); }
    return store.has(id) ? send(res, 200, store.get(id)) : send(res, 404, { message: 'not found' });
  }

  // Website webhook receiver (to test outbound webhooks)
  if (url.pathname === '/site-webhook') return send(res, 200, { received: true });

  send(res, 404, { message: 'no mock for this route' });
}).listen(9000, () => console.log('mock channels on :9000'));

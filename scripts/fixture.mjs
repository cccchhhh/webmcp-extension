import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname === '/tools.js' ? 'tools.js' : null;
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    'Content-Type',
    file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8',
  );
  res.end(await readFile(`tests/fixtures/${file}`));
}).listen(4177, '127.0.0.1', () => console.log('WebMCP fixture: http://127.0.0.1:4177'));

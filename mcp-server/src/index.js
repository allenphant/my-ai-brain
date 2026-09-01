import express from 'express';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { initFirestore } from './services/firestore.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MCP_API_KEY = process.env.MCP_API_KEY;

if (!MCP_API_KEY) {
  console.warn('⚠️ WARNING: MCP_API_KEY is not set. Requests will be rejected.');
}

// Constant-time token verification
export function verifyBearerToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid Bearer token' });
  }

  const token = authHeader.slice(7).trim();
  if (!MCP_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: MCP_API_KEY missing' });
  }

  try {
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(MCP_API_KEY);
    if (tokenBuf.length !== keyBuf.length || !crypto.timingSafeEqual(tokenBuf, keyBuf)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API token' });
    }
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
  }

  next();
}

app.use(express.json({ limit: '2mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// SSE Sessions map for legacy transport
const sseTransports = new Map();

// --- 1. Streamable HTTP Transport (/mcp) ---
const streamableTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined // stateless mode for wide compatibility
});
const mcpStreamableServer = createMcpServer();
await mcpStreamableServer.connect(streamableTransport);

app.all('/mcp', verifyBearerToken, async (req, res) => {
  try {
    await streamableTransport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('Error handling /mcp request:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// --- 2. Legacy SSE Transport (/sse & /messages) ---
app.get('/sse', verifyBearerToken, async (req, res) => {
  const mcpServer = createMcpServer();
  const transport = new SSEServerTransport('/messages', res);
  const sessionId = transport.sessionId;

  sseTransports.set(sessionId, transport);
  req.on('close', () => {
    sseTransports.delete(sessionId);
  });

  await mcpServer.connect(transport);
});

app.post('/messages', verifyBearerToken, async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  await transport.handlePostMessage(req, res);
});

// Start Server only if executed directly
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  try {
    initFirestore();
    console.log('✅ Scoped Firestore initialized successfully.');
  } catch (err) {
    console.warn(`⚠️ Firestore initialization deferred: ${err.message}`);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Remote MCP Server listening on port ${PORT}`);
    console.log(`📡 Streamable HTTP Endpoint: http://localhost:${PORT}/mcp`);
    console.log(`📡 Legacy SSE Endpoint: http://localhost:${PORT}/sse`);
  });
}

export default app;

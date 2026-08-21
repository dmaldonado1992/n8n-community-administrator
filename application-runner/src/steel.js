import { chromium } from 'playwright-core';

function headers(apiKey) {
  return apiKey ? { 'Content-Type': 'application/json', 'steel-api-key': apiKey } : { 'Content-Type': 'application/json' };
}

async function parseResponse(response) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) throw new Error(body.message || `Steel request failed (${response.status})`);
  return body;
}

export class SteelProvider {
  constructor({ baseUrl, apiKey }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async createSession() {
    const response = await fetch(`${this.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: headers(this.apiKey),
      body: JSON.stringify({ blockAds: true, dimensions: { width: 1440, height: 1000 }, sessionTimeout: 900000 }),
    });
    return parseResponse(response);
  }

  async getSession(sessionId) {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`, {
      headers: headers(this.apiKey),
    });
    return parseResponse(response);
  }

  async connect(session) {
    const endpoint = session.websocketUrl || session.websocket_url || session.connectUrl;
    if (!endpoint) throw new Error('Steel session did not provide a WebSocket URL');
    return chromium.connectOverCDP(endpoint);
  }

  async release(sessionId) {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: headers(this.apiKey),
    });
    if (response.status !== 404 && !response.ok) await parseResponse(response);
  }
}


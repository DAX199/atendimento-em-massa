// Minimal client for the Chatwoot account API, authenticated as the bot's own agent user.
export function chatwootClient({ url, accountId, token }) {
  const acc = `/api/v1/accounts/${accountId}`;
  async function call(method, path, body) {
    const res = await fetch(url + path, {
      method,
      headers: { api_access_token: token, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Chatwoot ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  return {
    profile: () => call('GET', '/api/v1/profile'),
    labels: () => call('GET', `${acc}/labels`).then((r) => r.payload),
    // Records a customer message: finds or creates the contact and the open conversation.
    incoming: (body) => call('POST', `${acc}/simulator/incoming`, body),
    conversations: (inboxId) => call('GET', `${acc}/conversations?inbox_id=${inboxId}&status=all`).then((r) => r.data.payload),
    messages: (convId, query = '') => call('GET', `${acc}/conversations/${convId}/messages${query}`),
    send: (convId, content, isPrivate = false) => call('POST', `${acc}/conversations/${convId}/messages`, { content, private: isPrivate }),
    conversationLabels: (convId) => call('GET', `${acc}/conversations/${convId}/labels`).then((r) => r.payload),
    setLabels: (convId, labels) => call('POST', `${acc}/conversations/${convId}/labels`, { labels }),
  };
}

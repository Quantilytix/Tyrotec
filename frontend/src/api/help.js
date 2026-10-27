import apiClient from './client';

// The Help chat. messages: [{ role: 'user'|'assistant', text }], ending with
// the question. Returns { answer }.
export const askHelp = (messages) => apiClient.post('/help/chat', { messages });

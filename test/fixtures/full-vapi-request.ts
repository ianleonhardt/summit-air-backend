import { readFileSync } from 'node:fs';

// Synthetic Vapi tool webhook: no live caller data or credentials.
export function fullVapiRequest(name: string, args: unknown, callId: string, toolCallId = 'large-payload-tool') {
  const tools = JSON.parse(readFileSync(new URL('../../vapi/tools.json', import.meta.url), 'utf8'));
  const prompt = readFileSync(new URL('../../vapi/system-prompt.txt', import.meta.url), 'utf8');
  const messages = [
    { role: 'system', message: prompt },
    ...Array.from({ length: 180 }, (_, i) => ({
      role: i % 2 ? 'bot' : 'user',
      message: ('Synthetic HVAC intake conversation with address, symptoms and scheduling clarification. ').repeat(12),
      time: 1792549501010 + i * 1000,
      secondsFromStart: i
    }))
  ];
  return { message: {
    timestamp: 1792549701010, type: 'tool-calls',
    call: { id: callId, type: 'inboundPhoneCall', customer: { number: '+12125550199' }, status: 'in-progress' },
    assistant: { name: 'Summit Air Receptionist', model: { provider: 'openai', model: 'gpt-4.1', messages: [{ role: 'system', content: prompt }], tools } },
    artifact: { messages, messagesOpenAIFormatted: messages.map(m => ({ role: m.role === 'bot' ? 'assistant' : m.role, content: m.message })) },
    toolCallList: [{ id: toolCallId, type: 'function', function: { name, arguments: args } }]
  }};
}

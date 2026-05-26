export const IPC = {
  SESSION_CREATE: 'session:create',
  SESSION_PROMPT: 'session:prompt',
  SESSION_CANCEL: 'session:cancel',
  SESSION_LIST: 'session:list',
  SYSTEM_DEFAULT_WORKDIR: 'system:default-workdir',
  AGENT_EVENT: 'agent:event',
  AGENT_APPROVAL: 'agent:approval',
  AGENT_APPROVAL_RESPOND: 'agent:approval:respond',
  AGENT_QUESTION: 'agent:question',
  AGENT_QUESTION_RESPOND: 'agent:question:respond',
} as const;

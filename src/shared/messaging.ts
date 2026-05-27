export type MessagingProviderId = 'telegram' | 'feishu';

export interface TelegramMessagingSettings {
  enabled: boolean;
  controlEnabled: boolean;
  chatId: string;
  botToken?: string;
  hasBotToken: boolean;
  clearBotToken?: boolean;
  webhookBaseUrl: string;
  localWebhookPort: number;
}

export interface FeishuMessagingSettings {
  enabled: boolean;
  webhookUrl?: string;
  hasWebhookUrl: boolean;
  clearWebhookUrl?: boolean;
  secret?: string;
  hasSecret: boolean;
  clearSecret?: boolean;
}

export interface MessagingSettings {
  notifyOnTurnEnd: boolean;
  notifyOnError: boolean;
  telegram: TelegramMessagingSettings;
  feishu: FeishuMessagingSettings;
}

export interface SaveMessagingSettingsResult {
  settings: MessagingSettings;
}

export interface TestMessagingInput {
  provider: MessagingProviderId;
  message?: string;
}

export interface TestMessagingResult {
  ok: boolean;
  message: string;
}

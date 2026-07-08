import { z } from "zod";

export const SettingsSchema = z.object({
  configEndpoint: z.string().url().optional(),
  aiEndpoint: z.string().url().optional(),
  stageBase: z.string().min(1).optional(),
  token: z.string().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function parseSettings(value: unknown): Settings {
  return SettingsSchema.parse(value);
}

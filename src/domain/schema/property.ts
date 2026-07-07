import { z } from "zod";

export const SiteIdSchema = z.number().int().positive();
export const BaseUrlSchema = z.string().url();

export const RenderModeSchema = z.enum(["rendered", "static"]);

export const PropertySchema = z.object({
  siteId: SiteIdSchema,
  baseUrl: BaseUrlSchema,
  renderMode: RenderModeSchema,
});

export type SiteId = z.infer<typeof SiteIdSchema>;
export type BaseUrl = z.infer<typeof BaseUrlSchema>;
export type RenderMode = z.infer<typeof RenderModeSchema>;
export type Property = z.infer<typeof PropertySchema>;

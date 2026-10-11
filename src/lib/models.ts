import type { AiModel, Tool } from '@/data/types';

/**
 * The AI model is an ADMIN decision, never a user choice.
 * Order of preference: the admin's default model if the tool allows it, otherwise the first enabled model
 * allowed for the tool (by admin order), otherwise any enabled default model.
 */
export function resolveModelId(tool: Pick<Tool, 'modelIds'> | undefined, models: AiModel[]): string | undefined {
  const ok = (m: AiModel) => m.enabled && m.visible !== false;
  const sorted = [...models].filter(ok).sort((a, b) => a.order - b.order);
  const allowed = sorted.filter((m) => tool?.modelIds?.includes(m.id));
  return (allowed.find((m) => m.isDefault) ?? allowed[0] ?? sorted.find((m) => m.isDefault) ?? sorted[0])?.id;
}

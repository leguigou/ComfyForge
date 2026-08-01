interface PromptEnhancementOptions {
  llmEnabled: boolean;
  hasProvider: boolean;
  isRegeneration: boolean;
  skipEnhancement: boolean;
  forceEnhancement: boolean;
}

export const shouldEnhancePrompt = ({
  llmEnabled,
  hasProvider,
  isRegeneration,
  skipEnhancement,
  forceEnhancement
}: PromptEnhancementOptions) => Boolean(
  hasProvider
  && !isRegeneration
  && !skipEnhancement
  && (llmEnabled || forceEnhancement)
);

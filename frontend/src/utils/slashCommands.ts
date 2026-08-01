export const SLASH_COMMAND_NAMES = [
  'ai',
  'luck',
  'seed',
  'steps',
  'cfg',
  'random',
  'favorite'
] as const;

export type SlashCommandName = typeof SLASH_COMMAND_NAMES[number];

export interface ParsedSlashCommand {
  name: SlashCommandName;
  argument: string;
}

export const getSlashCommandQuery = (input: string) => {
  const match = input.match(/^\/([a-z]*)$/i);
  return match ? match[1].toLowerCase() : undefined;
};

export const parseSlashCommand = (input: string): ParsedSlashCommand | undefined => {
  const match = input.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return undefined;

  const name = match[1].toLowerCase();
  if (!SLASH_COMMAND_NAMES.includes(name as SlashCommandName)) return undefined;

  return {
    name: name as SlashCommandName,
    argument: (match[2] || '').trim()
  };
};

export const parseSeedCommand = (argument: string) => {
  if (argument.toLowerCase() === 'random') {
    return { seedMode: 'random' as const, forcedSeed: '' };
  }
  if (!/^\d+$/.test(argument)) return undefined;
  return { seedMode: 'fixed' as const, forcedSeed: argument };
};

export const parseBoundedNumberCommand = (
  argument: string,
  minimum: number,
  maximum: number,
  integer = false
) => {
  if (!argument.trim()) return undefined;
  const value = Number(argument);
  if (!Number.isFinite(value) || value < minimum || value > maximum) return undefined;
  if (integer && !Number.isInteger(value)) return undefined;
  return value;
};

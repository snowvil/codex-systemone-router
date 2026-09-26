export interface ParsedOptions {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseOptions(
  args: string[],
  booleans: readonly string[],
  values: readonly string[],
): ParsedOptions {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("-") && !arg.startsWith("--"))
      throw new Error(
        `Unknown option: ${arg}; use -- before a task starting with -`,
      );
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equal = arg.indexOf("=");
    const name = equal < 0 ? arg : arg.slice(0, equal);
    if (Object.hasOwn(flags, name))
      throw new Error(`Duplicate option: ${name}`);
    if (booleans.includes(name)) {
      if (equal >= 0) throw new Error(`${name} does not take a value`);
      flags[name] = true;
    } else if (values.includes(name)) {
      const value = equal >= 0 ? arg.slice(equal + 1) : args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${name}`);
      flags[name] = value;
    } else {
      throw new Error(`Unknown option: ${name}`);
    }
  }
  return { flags, positionals };
}

export function stringFlag(
  flags: ParsedOptions["flags"],
  name: string,
): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

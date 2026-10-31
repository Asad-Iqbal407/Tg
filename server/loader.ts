/**
 * Resolve hook for the compiled server. The shared code under src/ imports its siblings without a file
 * extension, which Vite, Vitest and tsx accept. Plain Node ESM needs the extension, and tsc does not add
 * it, so a relative specifier that fails to resolve is retried with `.js`, the name tsc emitted.
 */
interface ResolveContext {
  parentURL?: string;
  conditions?: string[];
  importAttributes?: Record<string, string>;
}

interface ResolveResult {
  url: string;
  shortCircuit?: boolean;
  format?: string | null;
}

type NextResolve = (specifier: string, context: ResolveContext) => Promise<ResolveResult>;

const RELATIVE = /^\.{1,2}\//;

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): Promise<ResolveResult> {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const hasExtension = /\.[A-Za-z0-9]+$/.test(specifier);
    if (!RELATIVE.test(specifier) || hasExtension) throw error;
    return nextResolve(`${specifier}.js`, context);
  }
}

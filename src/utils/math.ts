// mathjs is large and only needed to evaluate cost expressions like "16*2", so it
// loads on demand instead of with the app
let mathjs: Promise<typeof import('mathjs')> | undefined;

export const loadMath = () => (mathjs ??= import('mathjs'));

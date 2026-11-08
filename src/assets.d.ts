declare module "*?raw" {
  const content: string;
  export default content;
}

interface ImportMeta {
  glob<T>(pattern: string, options: { eager: true; query: string; import: string }): Record<string, T>;
}

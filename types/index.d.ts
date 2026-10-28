export type Draft = { words: number; isIgnored: boolean }

declare module 'claude-code' {
  interface PluginState {
    'brain-dump-structurer': { draft: Shaped<Draft> }
  }
}

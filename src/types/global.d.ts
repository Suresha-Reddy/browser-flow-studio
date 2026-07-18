export {};
declare global {
  interface Window {
    __recordFlowEvent?: (event: unknown) => Promise<void>;
  }
}

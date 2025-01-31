declare module "process" {
  global {
    namespace NodeJS {
      interface ProcessEnv {
        DOMAIN?: string;
      }
    }
  }
}

// This package has no @types/node; declare only the one function used.
declare module "node:crypto" {
  export function createHash(algorithm: "sha256"): {
    update(data: string): { digest(encoding: "hex"): string };
  };
}

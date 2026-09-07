type NativeEsmImport = (specifier: string) => Promise<unknown>;

// The Pi packages expose ESM `import` entries without CommonJS `require`
// entries. Keep this import opaque to Rollup so the CJS utility-process bundle
// executes Node's native import() instead of rewriting it to require(). The
// specifier is passed as a parameter and is never interpolated into source.
const nativeEsmImport = Function(
  'specifier',
  'return import(specifier)',
) as NativeEsmImport;

export function importNativeEsm<T>(specifier: string): Promise<T> {
  return nativeEsmImport(specifier) as Promise<T>;
}

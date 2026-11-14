/** jsfive (public domain, pure-JS HDF5 reader): just what the SOFA import uses. */
declare module 'jsfive' {
  interface Node {
    value: unknown
    shape: number[]
    attrs: Record<string, unknown>
  }
  export class File {
    constructor(buffer: ArrayBuffer, filename?: string)
    readonly keys: string[]
    readonly attrs: Record<string, unknown>
    get(path: string): Node | null
  }
}

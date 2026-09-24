/**
 * Ambient declaration for the CSS Modules the client bundle imports.
 *
 * tsdown compiles each `*.module.css` into a hashed class map at build time;
 * TypeScript only needs to know the import yields an object of class names.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

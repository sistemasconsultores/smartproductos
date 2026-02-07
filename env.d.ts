/// <reference types="@remix-run/node" />
/// <reference types="vite/client" />

// Shopify App Bridge web components - augment global JSX namespace
export {};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
